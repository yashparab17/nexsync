fn main() {
    tauri_build::build();

    #[cfg(target_os = "windows")]
    {
        println!("cargo:rustc-link-arg=/NODEFAULTLIB:LIBCMTD");
        println!("cargo:rustc-link-arg=/NODEFAULTLIB:LIBCMT");
    }
}

