//! Ordo desktop shell: encrypted vault storage, folder watching, the Codex (ChatGPT) bridge and the interfaces to
//! other programs (local API on 127.0.0.1, outgoing HTTP for webhooks and ERP connections).
//! The Rust side never sees plaintext bookkeeping data – it only stores the encrypted bytes
//! produced by the web core.

mod api;
mod codex;
mod net;
mod storage;
mod watch;

use tauri::Manager;

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(watch::WatchState::default())
        .manage(api::ApiState::default())
        .setup(|app| {
            let dir = storage::data_dir(app.handle())?;
            std::fs::create_dir_all(dir.join("blobs"))?;
            std::fs::create_dir_all(dir.join("backups"))?;
            log::info!("Summa data dir: {}", dir.display());
            #[cfg(debug_assertions)]
            {
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            storage::app_info,
            storage::vault_read,
            storage::vault_write,
            storage::vault_exists,
            storage::vault_delete,
            storage::blob_read,
            storage::blob_write,
            storage::blob_delete,
            storage::blob_list,
            storage::storage_usage,
            storage::read_file,
            storage::write_file,
            storage::move_to_processed,
            storage::reveal_data_dir,
            storage::list_backups,
            storage::restore_backup,
            watch::watch_start,
            watch::watch_stop,
            watch::watch_scan,
            codex::codex_status,
            codex::codex_login,
            codex::codex_logout,
            codex::codex_extract,
            codex::codex_chat,
            codex::codex_cancel,
            api::api_start,
            api::api_stop,
            api::api_set_tokens,
            api::api_respond,
            api::api_status,
            net::net_fetch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Summa");
}
