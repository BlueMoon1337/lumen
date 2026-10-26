//! The Edit menu, as in ProPresenter: Undo and Redo, Cut, Copy ▸ (Copy, Copy Text Style),
//! Paste ▸ (Paste, Paste and Match Style, Paste Text Style), Duplicate, Delete, Select All,
//! Deselect All, Search, Spelling and Grammar ▸ and Transformations ▸.
//!
//! The commands run in the operator window, which works on the text in a field or, outside
//! one, on the selected slides (or presentation, playlist item…), and says which can run.
//! On macOS, Spelling and Grammar and Transformations are AppKit's own items, sent to the
//! focused text field, and the system adds Writing Tools, AutoFill, Start Dictation and Emoji
//! & Symbols after them, as it does to every Edit menu.

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

/// The Edit commands the operator window runs.
pub const COMMANDS: [&str; 17] = [
    "undo",
    "redo",
    "cut",
    "copy",
    "copy-style",
    "paste",
    "paste-plain",
    "paste-style",
    "duplicate",
    "delete",
    "select-all",
    "deselect-all",
    "search",
    "upper",
    "lower",
    "capitalize",
    "spell-check",
];

/// Edit's items that turn on and off with what's selected, and Undo and Redo, named after the
/// step they'd take.
pub struct EditMenu {
    undo: MenuItem<Wry>,
    redo: MenuItem<Wry>,
    items: Vec<(&'static str, MenuItem<Wry>)>,
    /// Check Spelling While Typing, where it's Lumen's own (not on macOS).
    spell_check: Option<CheckMenuItem<Wry>>,
}

pub fn build(app: &AppHandle) -> tauri::Result<(Submenu<Wry>, EditMenu)> {
    let item = |id: &'static str, text: &str, accelerator: Option<&str>| MenuItem::with_id(app, id, text, false, accelerator);
    let undo = item("undo", "Undo", Some("CmdOrCtrl+Z"))?;
    let redo = item("redo", "Redo", Some("Shift+CmdOrCtrl+Z"))?;
    let items = vec![
        ("cut", item("cut", "Cut", Some("CmdOrCtrl+X"))?),
        ("copy", item("copy", "Copy", Some("CmdOrCtrl+C"))?),
        ("copy-style", item("copy-style", "Copy Text Style", Some("Alt+CmdOrCtrl+C"))?),
        ("paste", item("paste", "Paste", Some("CmdOrCtrl+V"))?),
        (
            "paste-plain",
            item("paste-plain", "Paste and Match Style", Some("Alt+Shift+CmdOrCtrl+V"))?,
        ),
        ("paste-style", item("paste-style", "Paste Text Style", Some("Alt+CmdOrCtrl+V"))?),
        ("duplicate", item("duplicate", "Duplicate", Some("CmdOrCtrl+D"))?),
        // No key here: the Delete key belongs to text fields, and the page handles it elsewhere.
        ("delete", item("delete", "Delete", None)?),
        ("select-all", item("select-all", "Select All", Some("CmdOrCtrl+A"))?),
        ("deselect-all", item("deselect-all", "Deselect All", Some("Shift+CmdOrCtrl+A"))?),
        ("search", item("search", "Search", Some("CmdOrCtrl+F"))?),
        ("upper", item("upper", "Make Upper Case", None)?),
        ("lower", item("lower", "Make Lower Case", None)?),
        ("capitalize", item("capitalize", "Capitalize", None)?),
    ];
    let get = |id: &str| &items.iter().find(|(i, _)| *i == id).expect("edit item").1;
    let copy = Submenu::with_items(app, "Copy", true, &[get("copy"), get("copy-style")])?;
    let paste = Submenu::with_items(app, "Paste", true, &[get("paste"), get("paste-plain"), get("paste-style")])?;

    // macOS: AppKit's own submenus go in these (see `attach_text_menus`).
    #[cfg(target_os = "macos")]
    let (spelling, transformations, spell_check) = (
        Submenu::with_items(app, "Spelling and Grammar", true, &[])?,
        Submenu::with_items(app, "Transformations", true, &[])?,
        None,
    );
    #[cfg(not(target_os = "macos"))]
    let (spelling, transformations, spell_check) = {
        let check = CheckMenuItem::with_id(app, "spell-check", "Check Spelling While Typing", true, true, None::<&str>)?;
        (
            Submenu::with_items(app, "Spelling and Grammar", true, &[&check])?,
            Submenu::with_items(app, "Transformations", true, &[get("upper"), get("lower"), get("capitalize")])?,
            Some(check),
        )
    };

    let separator = || PredefinedMenuItem::separator(app);
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &undo,
            &redo,
            &separator()?,
            get("cut"),
            &copy,
            &paste,
            get("duplicate"),
            get("delete"),
            get("select-all"),
            get("deselect-all"),
            &separator()?,
            get("search"),
            &separator()?,
            &spelling,
            &transformations,
        ],
    )?;
    Ok((
        edit,
        EditMenu {
            undo,
            redo,
            items,
            spell_check,
        },
    ))
}

#[derive(Deserialize)]
pub struct UndoState {
    undo: Option<String>,
    redo: Option<String>,
}

/// Names the steps Undo and Redo would take, and turns them off when there's none.
#[tauri::command]
pub fn set_undo_state(menu: tauri::State<'_, EditMenu>, state: UndoState) {
    for (item, verb, label) in [(&menu.undo, "Undo", state.undo), (&menu.redo, "Redo", state.redo)] {
        // "&&" for a plain "&" in a step's name ("Edit Groups & Labels").
        let _ = item.set_text(
            label
                .as_deref()
                .map_or(verb.to_string(), |l| format!("{verb} {}", l.replace('&', "&&"))),
        );
        let _ = item.set_enabled(label.is_some());
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditState {
    /// The commands that can run now, by id.
    enabled: Vec<String>,
    spell_check: bool,
}

/// Turns Edit's items on and off as the selection changes.
#[tauri::command]
pub fn set_edit_state(menu: tauri::State<'_, EditMenu>, state: EditState) {
    for (id, item) in &menu.items {
        let _ = item.set_enabled(state.enabled.iter().any(|e| e == id));
    }
    if let Some(check) = &menu.spell_check {
        let _ = check.set_checked(state.spell_check);
    }
}

/// macOS: with a panel or sheet in front (a Save panel's name field, say), Edit's commands go to
/// it, as AppKit's own items would. Returns whether it did.
#[cfg(target_os = "macos")]
pub fn forward_to_panel(app: &AppHandle, id: &str) -> bool {
    use objc2::sel;
    use tauri::Manager;
    let action = match id {
        "undo" => sel!(undo:),
        "redo" => sel!(redo:),
        "cut" => sel!(cut:),
        "copy" => sel!(copy:),
        "paste" => sel!(paste:),
        "paste-plain" => sel!(pasteAsPlainText:),
        "delete" => sel!(delete:),
        "select-all" => sel!(selectAll:),
        _ => return false,
    };
    let main_is_key = app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
    if main_is_key {
        return false;
    }
    native::send(action);
    true
}

#[cfg(not(target_os = "macos"))]
pub fn forward_to_panel(_app: &AppHandle, _id: &str) -> bool {
    false
}

/// macOS: puts AppKit's Spelling and Grammar and Transformations menus into Edit, so they work
/// on the focused text field and turn on and off (and show their checkmarks) by themselves.
#[cfg(target_os = "macos")]
pub fn attach_text_menus() {
    native::attach_text_menus();
}

#[cfg(target_os = "macos")]
mod native {
    use objc2::rc::Retained;
    use objc2::runtime::Sel;
    use objc2::{MainThreadMarker, MainThreadOnly, sel};
    use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
    use objc2_foundation::NSString;

    /// Sends an action to whatever has the focus, as a menu item with no target does.
    pub fn send(action: Sel) {
        let Some(mtm) = MainThreadMarker::new() else { return };
        unsafe { NSApplication::sharedApplication(mtm).sendAction_to_from(action, None, None) };
    }

    type Entry = Option<(&'static str, Sel, &'static str)>;

    fn menu(mtm: MainThreadMarker, title: &str, entries: &[Entry]) -> Retained<NSMenu> {
        let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), &NSString::from_str(title));
        for entry in entries {
            let item = match entry {
                Some((title, action, key)) => unsafe {
                    NSMenuItem::initWithTitle_action_keyEquivalent(
                        NSMenuItem::alloc(mtm),
                        &NSString::from_str(title),
                        Some(*action),
                        &NSString::from_str(key),
                    )
                },
                None => NSMenuItem::separatorItem(mtm),
            };
            menu.addItem(&item);
        }
        menu
    }

    fn item_titled(menu: &NSMenu, title: &str) -> Option<Retained<NSMenuItem>> {
        (0..menu.numberOfItems())
            .filter_map(|i| menu.itemAtIndex(i))
            .find(|item| item.title().to_string() == title)
    }

    pub fn attach_text_menus() {
        let Some(mtm) = MainThreadMarker::new() else { return };
        let Some(main) = NSApplication::sharedApplication(mtm).mainMenu() else {
            return;
        };
        let Some(edit) = item_titled(&main, "Edit").and_then(|item| item.submenu()) else {
            return;
        };
        let menus: [(&str, &[Entry]); 2] = [
            (
                "Spelling and Grammar",
                &[
                    Some(("Show Spelling and Grammar", sel!(showGuessPanel:), ":")),
                    Some(("Check Document Now", sel!(checkSpelling:), ";")),
                    None,
                    Some(("Check Spelling While Typing", sel!(toggleContinuousSpellChecking:), "")),
                    Some(("Check Grammar With Spelling", sel!(toggleGrammarChecking:), "")),
                    Some(("Correct Spelling Automatically", sel!(toggleAutomaticSpellingCorrection:), "")),
                ],
            ),
            (
                "Transformations",
                &[
                    Some(("Make Upper Case", sel!(uppercaseWord:), "")),
                    Some(("Make Lower Case", sel!(lowercaseWord:), "")),
                    Some(("Capitalize", sel!(capitalizeWord:), "")),
                ],
            ),
        ];
        for (title, entries) in menus {
            if let Some(item) = item_titled(&edit, title) {
                item.setSubmenu(Some(&menu(mtm, title, entries)));
            }
        }
    }
}
