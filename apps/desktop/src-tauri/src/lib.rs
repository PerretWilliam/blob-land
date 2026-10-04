// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WindowEvent,
};

/// Closing the window only hides it (the blob lives on in the tray): this is how the app really quits.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// WebKit draws pages at 60 fps at most, even on a 120 Hz screen, unless its
/// "PreferPageRenderingUpdatesNear60FPS" feature is turned off. Only reachable
/// through WKPreferences' private feature list, so a missing feature is skipped.
#[cfg(target_os = "macos")]
fn unlock_frame_rate(window: &tauri::WebviewWindow) {
    use objc2::{msg_send, runtime::{AnyClass, AnyObject, Bool}};
    use objc2_foundation::{NSArray, NSString};
    let _ = window.with_webview(|webview| unsafe {
        let Some(class) = AnyClass::get(c"WKPreferences") else { return };
        let wk = webview.inner() as *mut AnyObject;
        // The configuration is a copy, but shares the live preferences object.
        let config: *mut AnyObject = msg_send![wk, configuration];
        let prefs: *mut AnyObject = msg_send![config, preferences];
        let features: *mut NSArray<AnyObject> = msg_send![class, _features];
        if prefs.is_null() || features.is_null() {
            return;
        }
        for feature in (*features).iter() {
            let key: *mut NSString = msg_send![&*feature, key];
            if !key.is_null() && (*key).to_string() == "PreferPageRenderingUpdatesNear60FPSEnabled" {
                let _: () = msg_send![prefs, _setEnabled: Bool::NO, forFeature: &*feature];
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![quit])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                unlock_frame_rate(&window);
            }
            // Tray: left-click shows/focuses the main window, "Quit" actually exits.
            // Closing the window instead hides it (see on_window_event below) so the
            // blob keeps living in the background.
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // ponytail: global "hide instead of close" rule, per-window opt-out if a
            // second window ever needs to actually close.
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
