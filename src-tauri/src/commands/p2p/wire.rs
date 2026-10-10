//! Wire format shared by both sides of a Nexsync P2P connection.
//!
//! Every QUIC bi-directional stream starts with a single stream-kind byte.
//! After that, structured data is sent as length-prefixed frames
//! (`u32` big-endian length followed by that many bytes of JSON).

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// ALPN protocol identifier; peers speaking a different version refuse to connect
pub const ALPN: &[u8] = b"nexsync/p2p/1";

/// Bumped whenever the handshake or message format changes incompatibly
pub const PROTOCOL_VERSION: u32 = 1;

/// Format number of a task or card's merge state (`RecordState`). Raise it only for a change that an older app would
/// misread; a change that only adds a field does not need it (older apps keep what they cannot read).
pub const RECORD_FORMAT: u32 = 1;

/// The oldest record format this build still merges with
pub const MIN_RECORD_FORMAT: u32 = 1;

/// Format number of the signed member list
pub const LIST_FORMAT: u32 = 1;

/// What a device runs, announced in the handshake. Optional on the wire, so an app from before this existed sends
/// nothing and is treated as running the first formats.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Versions {
    pub app: String,
    pub record: u32,
    pub list: u32,
}

impl Versions {
    pub fn ours() -> Self {
        Versions { app: env!("CARGO_PKG_VERSION").to_string(), record: RECORD_FORMAT, list: LIST_FORMAT }
    }
}

/// How the other device's formats compare with ours
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Skew {
    /// The same formats
    Same,
    /// They run a newer format: link, keep what we cannot read, and tell the person to update
    TheyAreNewer,
}

/// Decides whether to link to a device that announced `theirs`. A device that announced nothing is taken to run the
/// first formats. Only a record format older than the oldest we merge with is refused, and the reason names it.
pub fn check_versions(theirs: Option<&Versions>) -> Result<Skew, String> {
    let Some(v) = theirs else { return Ok(Skew::Same) };
    if v.record < MIN_RECORD_FORMAT {
        return Err(format!(
            "That device (Nexsync {}) stores tasks and cards in an older format (record format {}; this app needs {} or newer). Ask them to update.",
            v.app, v.record, MIN_RECORD_FORMAT
        ));
    }
    Ok(if v.record > RECORD_FORMAT || v.list > LIST_FORMAT { Skew::TheyAreNewer } else { Skew::Same })
}

/// Opened once by the guest after connecting; carries the handshake then app messages
pub const STREAM_CONTROL: u8 = 1;

/// Opened by either side to request a single file from the other
pub const STREAM_FILE: u8 = 2;

/// Upper bound on handshake and file-request frames
pub const MAX_SMALL_FRAME: usize = 64 * 1024;

/// Upper bound on a single application message (workspace snapshots included)
pub const MAX_MESSAGE_FRAME: usize = 16 * 1024 * 1024;

/// First frame sent by a guest on the control stream
#[derive(Debug, Serialize, Deserialize)]
pub struct Hello {
    pub v: u32,
    pub secret: String,
    pub name: String,
    /// Asks only for the other device's member list and then hangs up: no link is made and no data moves. A device that
    /// has just come online uses it to learn of a removal before it lets any member in.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub probe: bool,
    /// The formats this device runs; absent from an app that predates it
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub versions: Option<Versions>,
}

/// Host's answer to a [`Hello`]
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HandshakeReply {
    #[serde(rename_all = "camelCase")]
    Welcome {
        v: u32,
        host_name: String,
        role: String,
        workspace_id: String,
        workspace_name: String,
        /// The formats the host runs; absent from an app that predates it
        #[serde(default, skip_serializing_if = "Option::is_none")]
        versions: Option<Versions>,
    },
    Reject { error: String },
    /// The answer to a probe: the signed member list this device holds, as JSON, if it holds one
    Membership { doc: Option<String> },
}

/// Sent on a file stream by the side that wants the file
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRequest {
    pub rel_path: String,
    /// Bytes the requester already has; honored only when `version` still matches the source
    #[serde(default)]
    pub offset: u64,
    /// `version` from the earlier reply that produced those bytes
    #[serde(default)]
    pub version: u64,
}

/// Sent back on a file stream before the raw file bytes
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FileReply {
    /// `size` is the whole file, `offset` is where the bytes that follow start (0 unless resuming)
    Ok {
        size: u64,
        #[serde(default)]
        version: u64,
        #[serde(default)]
        offset: u64,
    },
    Error { error: String },
}

/// Writes one length-prefixed frame
pub async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, bytes: &[u8]) -> std::io::Result<()> {
    let len = u32::try_from(bytes.len())
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "frame too large"))?;
    writer.write_all(&len.to_be_bytes()).await?;
    writer.write_all(bytes).await
}

/// Reads one length-prefixed frame, or `None` if the stream ended cleanly between frames
pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R, max_len: usize) -> std::io::Result<Option<Vec<u8>>> {
    let mut len_buf = [0u8; 4];
    // A clean end of stream is only valid before the first byte of a frame
    match reader.read_exact(&mut len_buf).await {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let len = u32::from_be_bytes(len_buf) as usize;
    if len > max_len {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("peer sent a {len}-byte frame (limit is {max_len})"),
        ));
    }
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf).await?;
    Ok(Some(buf))
}

/// Serializes `value` as JSON and writes it as one frame
pub async fn write_json<W: AsyncWrite + Unpin, T: Serialize>(writer: &mut W, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    write_frame(writer, &bytes).await.map_err(|e| e.to_string())
}

/// Reads one frame and parses it as JSON, treating end of stream as an error
pub async fn read_json<R: AsyncRead + Unpin, T: DeserializeOwned>(reader: &mut R, max_len: usize) -> Result<T, String> {
    let bytes = read_frame(reader, max_len)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Peer closed the stream unexpectedly.".to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("Malformed message from peer: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_frame_roundtrip() {
        let mut buf = Vec::new();
        write_frame(&mut buf, b"hello").await.unwrap();
        write_frame(&mut buf, b"").await.unwrap();
        let mut reader = buf.as_slice();
        assert_eq!(read_frame(&mut reader, 1024).await.unwrap().unwrap(), b"hello");
        assert_eq!(read_frame(&mut reader, 1024).await.unwrap().unwrap(), b"");
        assert!(read_frame(&mut reader, 1024).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_oversized_frame_rejected() {
        let mut buf = Vec::new();
        write_frame(&mut buf, &[0u8; 100]).await.unwrap();
        let mut reader = buf.as_slice();
        assert!(read_frame(&mut reader, 10).await.is_err());
    }

    fn theirs(record: u32, list: u32) -> Versions {
        Versions { app: "9.9.9".into(), record, list }
    }

    #[test]
    fn a_device_that_announces_nothing_or_the_same_formats_is_linked() {
        assert_eq!(check_versions(None), Ok(Skew::Same));
        assert_eq!(check_versions(Some(&Versions::ours())), Ok(Skew::Same));
    }

    #[test]
    fn a_newer_format_is_linked_and_flagged_and_an_older_one_than_we_merge_with_is_refused_by_name() {
        assert_eq!(check_versions(Some(&theirs(RECORD_FORMAT + 1, LIST_FORMAT))), Ok(Skew::TheyAreNewer));
        assert_eq!(check_versions(Some(&theirs(RECORD_FORMAT, LIST_FORMAT + 1))), Ok(Skew::TheyAreNewer));
        let err = check_versions(Some(&theirs(MIN_RECORD_FORMAT - 1, LIST_FORMAT))).unwrap_err();
        assert!(err.contains("record format 0") && err.contains("9.9.9") && err.contains("update"), "{err}");
    }

    #[test]
    fn handshakes_from_before_the_versions_existed_and_from_after_still_read() {
        // What an app from before this field sent
        let old = r#"{"v":1,"secret":"s","name":"A"}"#;
        let hello: Hello = serde_json::from_str(old).unwrap();
        assert!(hello.versions.is_none() && !hello.probe);
        // What a later app might send, with a field this one has never heard of
        let future = r#"{"v":1,"secret":"s","name":"A","versions":{"app":"2.0.0","record":2,"list":1,"theme":"x"},"colour":"red"}"#;
        let hello: Hello = serde_json::from_str(future).unwrap();
        assert_eq!(hello.versions.unwrap().record, 2);
        // And the host's side
        let welcome = r#"{"type":"welcome","v":1,"hostName":"H","role":"Editor","workspaceId":"w","workspaceName":"W"}"#;
        assert!(matches!(serde_json::from_str::<HandshakeReply>(welcome).unwrap(), HandshakeReply::Welcome { versions: None, .. }));
        // This app's own announcement does not add noise when there is nothing to say
        let ours = serde_json::to_string(&Hello { v: 1, secret: "s".into(), name: "A".into(), probe: false, versions: None }).unwrap();
        assert!(!ours.contains("versions") && !ours.contains("probe"), "{ours}");
    }

    #[tokio::test]
    async fn test_truncated_frame_is_error() {
        let mut buf = Vec::new();
        write_frame(&mut buf, b"hello").await.unwrap();
        buf.truncate(6);
        let mut reader = buf.as_slice();
        assert!(read_frame(&mut reader, 1024).await.is_err());
    }

    #[test]
    fn test_handshake_reply_json_shape() {
        let json = serde_json::to_value(HandshakeReply::Reject { error: "no".into() }).unwrap();
        assert_eq!(json["type"], "reject");
        assert_eq!(json["error"], "no");
    }
}
