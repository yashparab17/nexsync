//! Generators (Phase 20, ideas): a team's own scaffolds, kept in the project as `nexsync.generators.json` and so shared like any
//! file. A generator asks for a few names and writes new files from templates (a component, a route, a migration), the way Plop
//! and Hygen do.
//!
//! A generator only writes files. It starts no program, so it needs no approval; what keeps it safe is that every name it takes is
//! plain (letters, digits, space, `_`, `-`, `.`), every file it writes lands inside the project, and it never replaces a file
//! that exists: if any file is already there it writes nothing and says which.

use std::{collections::HashMap, fs, path::Path};

use serde::{Deserialize, Serialize};

use super::{project_dir, valid_name};
use crate::commands::workspace::syncignore::PROJECTS_ROOT;
use crate::commands::{config::validate_allowed_root, path_utils::resolve_workspace_path};

const FILE: &str = "nexsync.generators.json";
const MAX_FILE_BYTES: u64 = 256 * 1024;
const MAX_GENERATORS: usize = 30;
const MAX_FILES: usize = 20;
const MAX_INPUTS: usize = 6;
const MAX_TEMPLATE: usize = 64 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub default: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    /// Where the file goes, inside the project; may hold placeholders
    pub path: String,
    #[serde(default)]
    pub template: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Generator {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub inputs: Vec<Input>,
    pub files: Vec<Template>,
}

#[derive(Deserialize)]
struct Doc {
    generators: Vec<Generator>,
}

/// A name a person types: short, and nothing that can make a path or a command
pub fn plain_value(v: &str) -> bool {
    let v = v.trim();
    !v.is_empty() && v.len() <= 64 && v.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '_' | '-' | '.')) && !v.starts_with('.')
}

/// The words of a name: split on anything that is not a letter or digit, and where a lower-case letter meets an upper-case one
fn words(v: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut prev_lower = false;
    for c in v.chars() {
        if !c.is_ascii_alphanumeric() {
            if !cur.is_empty() {
                out.push(std::mem::take(&mut cur));
            }
            prev_lower = false;
            continue;
        }
        if c.is_ascii_uppercase() && prev_lower && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        prev_lower = c.is_ascii_lowercase() || c.is_ascii_digit();
        cur.push(c);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn capital(w: &str) -> String {
    let mut c = w.chars();
    c.next().map(|f| f.to_ascii_uppercase().to_string() + &c.as_str().to_ascii_lowercase()).unwrap_or_default()
}

fn transform(v: &str, how: &str) -> Option<String> {
    let w = words(v);
    Some(match how {
        "" => v.trim().to_string(),
        "pascal" => w.iter().map(|x| capital(x)).collect(),
        "camel" => w.iter().enumerate().map(|(i, x)| if i == 0 { x.to_ascii_lowercase() } else { capital(x) }).collect(),
        "kebab" => w.iter().map(|x| x.to_ascii_lowercase()).collect::<Vec<_>>().join("-"),
        "snake" => w.iter().map(|x| x.to_ascii_lowercase()).collect::<Vec<_>>().join("_"),
        "upper" => w.iter().map(|x| x.to_ascii_uppercase()).collect::<Vec<_>>().join("_"),
        _ => return None,
    })
}

/// Fills `{{name}}` and `{{name|pascal}}` (also camel, kebab, snake, upper) from the values; a placeholder it does not know is an error
pub fn render(text: &str, values: &HashMap<String, String>) -> Result<String, String> {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("{{") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        let Some(j) = after.find("}}") else { return Err("A template has {{ with no }}.".to_string()) };
        let (name, how) = after[..j].trim().split_once('|').map(|(n, h)| (n.trim(), h.trim())).unwrap_or((after[..j].trim(), ""));
        let value = values.get(name).ok_or_else(|| format!("A template uses {{{{{name}}}}}, which the generator does not ask for."))?;
        out.push_str(&transform(value, how).ok_or_else(|| format!("{{{{{name}|{how}}}}}: the forms are pascal, camel, kebab, snake and upper."))?);
        rest = &after[j + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

/// The generators of a project, or why its file cannot be used
pub fn load(dir: &Path) -> Result<Vec<Generator>, String> {
    let file = dir.join(FILE);
    let Ok(meta) = fs::metadata(&file) else { return Ok(Vec::new()) };
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!("{FILE} is too big."));
    }
    let text = fs::read_to_string(&file).map_err(|_| format!("{FILE} cannot be read."))?;
    let doc: Doc = serde_json::from_str(&text).map_err(|e| format!("{FILE} is not valid: {e}"))?;
    if doc.generators.len() > MAX_GENERATORS {
        return Err(format!("A project may have at most {MAX_GENERATORS} generators."));
    }
    let mut seen = std::collections::HashSet::new();
    for g in &doc.generators {
        if !valid_name(&g.id) || !seen.insert(g.id.clone()) {
            return Err(format!("Generator name \"{}\" is empty, repeated or has other characters than letters, digits, - _ and .", g.id));
        }
        if g.files.is_empty() || g.files.len() > MAX_FILES || g.inputs.len() > MAX_INPUTS {
            return Err(format!("Generator \"{}\" needs 1 to {MAX_FILES} files and at most {MAX_INPUTS} inputs.", g.id));
        }
        if g.inputs.iter().any(|i| !valid_name(&i.id)) || g.files.iter().any(|f| f.template.len() > MAX_TEMPLATE || f.path.trim().is_empty()) {
            return Err(format!("Generator \"{}\" has an input name that is not valid, an empty path, or a template that is too big.", g.id));
        }
        if g.inputs.iter().any(|i| !i.default.is_empty() && !plain_value(&i.default)) {
            return Err(format!("Generator \"{}\" has a default that is not a plain name.", g.id));
        }
    }
    Ok(doc.generators)
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    /// Inside the project
    pub path: String,
    pub exists: bool,
}

/// The files a generator would write for these values, each with a note when it is already there; the path of every one is checked
pub fn plan(dir: &Path, g: &Generator, values: &HashMap<String, String>) -> Result<Vec<(Planned, String)>, String> {
    for i in &g.inputs {
        if !values.get(&i.id).is_some_and(|v| plain_value(v)) {
            return Err(format!("{} needs a plain name: letters, digits, spaces, - _ and ., up to 64.", if i.label.is_empty() { &i.id } else { &i.label }));
        }
    }
    let mut out = Vec::new();
    for f in &g.files {
        let rel = render(&f.path, values)?.trim().replace('\\', "/");
        if rel.is_empty() || rel.starts_with('/') || rel.split('/').any(|p| p.is_empty() || p == ".." || p == "." || p.contains(':')) || rel.contains('\0') {
            return Err(format!("A path (\"{rel}\") would leave the project or is not a path."));
        }
        let exists = dir.join(&rel).symlink_metadata().is_ok();
        out.push((Planned { path: rel, exists }, render(&f.template, values)?));
    }
    Ok(out)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Generators {
    pub generators: Vec<Generator>,
    pub error: Option<String>,
}

#[tauri::command(async)]
pub fn project_generators(app_handle: tauri::AppHandle, path: String, project: String) -> Result<Generators, String> {
    validate_allowed_root(&app_handle, &path)?;
    Ok(match load(&project_dir(&path, &project)?) {
        Ok(generators) => Generators { generators, error: None },
        Err(e) => Generators { generators: Vec::new(), error: Some(e) },
    })
}

/// Lists the files a generator would write (`dry_run`), or writes them. If any file already exists nothing is written.
#[tauri::command(async)]
pub fn project_generate(app_handle: tauri::AppHandle, path: String, project: String, generator: String, values: HashMap<String, String>, dry_run: bool) -> Result<Vec<Planned>, String> {
    validate_allowed_root(&app_handle, &path)?;
    let dir = project_dir(&path, &project)?;
    let g = load(&dir)?.into_iter().find(|g| g.id == generator).ok_or("That generator is no longer in the project.")?;
    let planned = plan(&dir, &g, &values)?;
    if dry_run {
        return Ok(planned.into_iter().map(|(p, _)| p).collect());
    }
    if let Some((p, _)) = planned.iter().find(|(p, _)| p.exists) {
        return Err(format!("{} is already there. Nothing was written.", p.path));
    }
    // Each target is resolved against the workspace, which refuses anything that leaves it
    let targets: Vec<_> = planned.iter().map(|(p, _)| resolve_workspace_path(&path, &format!("{PROJECTS_ROOT}/{project}/{}", p.path))).collect::<Result<_, _>>()?;
    for (target, (_, body)) in targets.iter().zip(&planned) {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        use std::io::Write;
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(target).map_err(|e| format!("{} could not be written: {e}", target.display()))?;
        f.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(planned.into_iter().map(|(p, _)| p).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn placeholders_take_the_forms_a_team_writes_names_in() {
        let v = values(&[("name", "user profile")]);
        assert_eq!(render("{{name|pascal}} {{name|camel}} {{name|kebab}} {{name|snake}} {{name|upper}} {{name}}", &v).unwrap(), "UserProfile userProfile user-profile user_profile USER_PROFILE user profile");
        assert_eq!(render("{{ name | pascal }}", &values(&[("name", "userProfile")])).unwrap(), "UserProfile");
        assert!(render("{{other}}", &v).is_err() && render("{{name|loud}}", &v).is_err() && render("{{name", &v).is_err());
    }

    #[test]
    fn only_plain_names_are_taken() {
        for ok in ["Button", "user profile", "v1.2", "a-b_c"] {
            assert!(plain_value(ok), "{ok}");
        }
        for bad in ["", "../x", "a/b", "a\\b", ".hidden", "a;b", "$(x)", &"x".repeat(65)] {
            assert!(!plain_value(bad), "{bad}");
        }
    }

    #[test]
    fn a_generator_writes_new_files_and_never_replaces_one() {
        let d = std::env::temp_dir().join(format!("nexsync-gen-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join(FILE),
            r#"{"generators":[{"id":"component","inputs":[{"id":"name","label":"Name"}],"files":[{"path":"src/{{name|pascal}}.tsx","template":"export const {{name|pascal}} = () => null;\n"},{"path":"src/{{name|pascal}}.test.tsx","template":"// {{name}}\n"}]}]}"#,
        )
        .unwrap();
        let g = load(&d).unwrap().remove(0);
        let v = values(&[("name", "side bar")]);
        let planned = plan(&d, &g, &v).unwrap();
        assert_eq!(planned.iter().map(|(p, _)| (p.path.as_str(), p.exists)).collect::<Vec<_>>(), [("src/SideBar.tsx", false), ("src/SideBar.test.tsx", false)]);
        assert_eq!(planned[0].1, "export const SideBar = () => null;\n");
        // A name that would make a path leave the project is refused before anything is planned
        assert!(plan(&d, &g, &values(&[("name", "../../x")])).is_err());
        // The same generator twice: the second finds the files
        fs::create_dir_all(d.join("src")).unwrap();
        fs::write(d.join("src/SideBar.tsx"), "mine").unwrap();
        assert!(plan(&d, &g, &v).unwrap()[0].0.exists);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn a_file_from_someone_else_is_checked() {
        let d = std::env::temp_dir().join(format!("nexsync-gen-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        for bad in [
            r#"{"generators":[{"id":"a b","files":[{"path":"x"}]}]}"#,
            r#"{"generators":[{"id":"a","files":[]}]}"#,
            r#"{"generators":[{"id":"a","inputs":[{"id":"n","default":"../x"}],"files":[{"path":"x"}]}]}"#,
            r#"{"generators":[{"id":"a","files":[{"path":"x"}]},{"id":"a","files":[{"path":"y"}]}]}"#,
            "nonsense",
        ] {
            fs::write(d.join(FILE), bad).unwrap();
            assert!(load(&d).is_err(), "{bad}");
        }
        fs::remove_file(d.join(FILE)).unwrap();
        assert!(load(&d).unwrap().is_empty());
        let _ = fs::remove_dir_all(&d);
    }
}
