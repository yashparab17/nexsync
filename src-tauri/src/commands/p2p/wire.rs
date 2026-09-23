//! Wire format shared by both sides of a NexSync P2P connection.
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
    },
    Reject { error: String },
}

/// Sent on a file stream by the side that wants the file
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRequest {
    pub rel_path: String,
}

/// Sent back on a file stream before the raw file bytes
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FileReply {
    Ok { size: u64 },
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
