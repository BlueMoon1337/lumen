<img src="docs/icon.png" alt="Lumen icon" width="112">

# Lumen

Live presentation software for worship services and events, in the spirit of ProPresenter. It lets you build a song and scripture library, plan the service in a playlist, and run lyrics, backgrounds, messages and countdowns on an audience screen and a stage confidence monitor.

The interface deliberately mirrors ProPresenter 7's layout and terms, so teams switching over find things where they expect them.

![Show mode](docs/control.png)

![Edit mode](docs/edit.png)

| Audience output                | Stage display            |
| ------------------------------ | ------------------------ |
| ![Audience](docs/audience.png) | ![Stage](docs/stage.png) |

## Running it

Requires Node.js 20 or newer.

```sh
npm install
npm run dev          # operator UI at http://localhost:5173
```

The first time Lumen starts, it asks you to choose its icon: the **Projector** (the default, already selected), the blue **Star**, the yellow **Camera** or the black-and-white **Film Camera**. You can change it later in **Settings → App Icon**. The choice applies to the browser tab and, in the desktop app, to the Dock or taskbar.

**Settings → Startup** (desktop app) can open Lumen when you log in to the computer: a login item on macOS, a startup entry on Windows and Linux.

**Settings → Highlight Color** picks the color of selections, the open library or playlist and buttons that are on: ProPresenter's **Pink** (the default) or macOS's **Blue**. Menus highlight in it too. The library icons and the dot on a live library or playlist item are lime with pink and orange with blue; the playlist icons are deep blue with pink and red with blue.

Click **Audience** or **Stage** in the toolbar to open the output windows. In Chrome or Edge, open **Screens → Configure Screens…** (More menu, or right-click Audience) and press **Detect Screens** once: the outputs then open fullscreen on your TV or projector by themselves. In other browsers, drag the window to the projector and double-click it for fullscreen.

### As a desktop app

The desktop app is built with [Tauri](https://tauri.app). It's a small native app that uses the web engine already in the computer (Safari's on a Mac, WebView2 on Windows) instead of bundling a browser. It opens each output fullscreen on its display, adds ProPresenter's menus (File, Edit, Presentation and **Screens**: ⌘1 Audience, ⌘2 Stage, Live looks, Edit Looks…, Edit Layouts…, ⌥⌘1 Configure Screens…, Capture), and lists displays by their real names. Outputs come up as soon as an HDMI cable goes in and return when an unplugged screen is reconnected.

One-time setup:

- **Mac:** install Apple's command-line tools with `xcode-select --install`, then Rust with `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`. Close and reopen Terminal afterwards.
- **Windows:** install the Microsoft C++ Build Tools (the "Desktop development with C++" workload), then Rust from [rustup.rs](https://rustup.rs). WebView2 already comes with Windows 10 and 11.
- **Linux:** the WebKitGTK packages in [Tauri's prerequisites](https://tauri.app/start/prerequisites/), then Rust.

```sh
npm run desktop        # run the desktop app while you work on it (reloads as you edit)
npm run desktop:build  # build the finished, installable app
```

`desktop:build` puts the app in `src-tauri/target/release/bundle/`. On a Mac that's `macos/Lumen.app` (drag it into Applications) and a `.dmg` disk image; on Windows, an `.msi` installer and a setup `.exe`. The first build downloads and compiles the Rust libraries and takes several minutes; later builds are much quicker.

An app you build runs on your own computer. Before it can be handed to other Macs without the "unidentified developer" warning, it has to be signed and notarized with an Apple Developer account. Until then, right-click the app and choose **Open** the first time. A signed build also needs the camera entitlement (`com.apple.security.device.camera`) for Video Input; `src-tauri/Info.plist` already has the message macOS shows when it asks.

### Updates

The desktop app's **Update** button (at the top of **Settings**; also **Lumen ▸ Check for Updates…** on a Mac, **Help ▸ Check for Updates…** elsewhere, and **More ▸ Check for Updates…**) installs new versions of Lumen without building anything:

1. The first time, it asks for a GitHub token, because the repository is private. Make a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with access to **Only select repositories ▸ lumen** and **Contents: Read-only**, and paste it in. Lumen keeps it in a file in its settings folder, on this computer only.
2. Lumen looks for a newer release when it starts and every six hours. When there is one, the **Settings** button gets a pink dot, and Settings says which version is ready.
3. Click it to see what's new, then **Install and Restart**. Lumen downloads the new version, checks its signature, replaces itself and starts again. Your library, playlists and settings are kept.

**Publishing a release.** Releases are built by GitHub Actions (`.github/workflows/release.yml`) for macOS (one app for Apple silicon and Intel) and Windows:

1. Raise `version` in `package.json` and `src-tauri/Cargo.toml` (Lumen only offers a release newer than itself).
2. Push that to `main`: the workflow starts by itself when the version in `package.json` hasn't been released yet. (Pushing a tag such as `v0.3.0`, or **Actions ▸ Release ▸ Run workflow** on GitHub, also starts it.)
3. The workflow makes a draft release (its notes are the commits since the last one), builds and signs both apps into it, then adds `latest.json` (what the Update button reads) and publishes it. It takes 15 to 25 minutes. Releases are immutable once published, so a version that has been published can't be used again: raise it.

The update files are signed with a private key kept as the repository secret `TAURI_SIGNING_PRIVATE_KEY` (**Settings ▸ Secrets and variables ▸ Actions**); its public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, and Lumen refuses any update not signed with it. Keep a copy of the private key somewhere safe: without it, no new version can be published to apps that already have this public key.

On a Mac, open the `.dmg` from the release: its window shows how to install (drag Lumen onto Applications) with a **Read Me First** file below for the first launch. The Mac background is drawn by `scripts/dmg-background.py`, and `.github/scripts/dmg-readme.sh` adds the Read Me during the release. The apps from a release are ad-hoc signed, not notarized, so the first time you open one downloaded with a browser, macOS asks: right-click it and choose **Open** (or **System Settings ▸ Privacy & Security ▸ Open Anyway**). Updates installed by the Update button don't ask again. If the Update window says macOS is running Lumen from a temporary, read-only copy (App Translocation, for an app downloaded with a browser), quit Lumen, make sure it's in Applications, run `xattr -dr com.apple.quarantine /Applications/Lumen.app` in Terminal once, and open it again. An app you build yourself with `npm run desktop:build` can update itself the same way.

### Other scripts

```sh
npm test             # unit tests (Vitest)
npm run typecheck
npm run build        # production build into dist/
npm run format       # Prettier
```

## Where things are (for ProPresenter users)

| ProPresenter                                                                                                                                                                           | Lumen                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolbar: Search · Text, Theme · Show, Edit, Reflow, Bible, More                                                                                                                        | Same buttons, same order. Text and Theme drop down panels that apply to the selected presentation.                                                                                                                                                                                                                                                                                                                                                                |
| Toolbar: Media, Audience, Stage                                                                                                                                                        | Media toggles the media bin. Audience and Stage turn those screens on or off; the ring is green when they're showing and orange when some outputs aren't. Right-click either one to configure screens.                                                                                                                                                                                                                                                            |
| Screens menu and Screen Configuration (⌥⌘1)                                                                                                                                            | Same layout: Audience and Stage lists with on/off switches and +, Identify Screens, Test Patterns, then per screen its name, size, Screen Color, Outputs, the output tiles, and Hardware / Color / Corner Pin / Alpha Key tabs. See Screens below.                                                                                                                                                                                                                |
| Bible: reference with Book › Chapter › Verse menu, Search, Options; translation with Verse and Reference boxes, License, +; Save As…                                                   | Same layout and options. See Bible below.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Dividers between the panes (library, slides, media bin, live panel, and above the live panel’s tabs)                                                                                   | Same: drag to resize, double-click to reset. Edit mode’s slide list and inspector resize too. Sizes are kept; **Reset Sizes** in the toolbar (beside Media), or Settings ▸ Layout ▸ Reset Section Sizes, puts them all back.                                                                                                                                                                                                                                      |
| Library and Playlist at the top left, items below with a Filter                                                                                                                        | Same. Libraries are Songs, Scripture, Announcements and Other, plus any made with **New Library**. Drag a presentation onto a library or playlist name to move or add it. Drag libraries and playlists up or down to reorder them. ⌘-click (Ctrl-click) or ⇧-click presentations to highlight several, then drag them or right-click ▸ Add to Playlist / Library: adding several to a playlist adds only the ones not in it yet (one on its own can go in twice). |
| Slide grid with numbered, colored group labels                                                                                                                                         | Same. Click a slide to go live (orange border), double-click to edit it.                                                                                                                                                                                                                                                                                                                                                                                          |
| Media bin along the bottom, with Playlists                                                                                                                                             | Same: All Media / Images / Videos, media Playlists and Video Inputs on the left. Click an item to play it on the Media layer, or a camera to show it underneath. Drag a video onto a slide to play it with that slide.                                                                                                                                                                                                                                            |
| Preview with clear buttons on its right edge, ✕ for Clear All, Clear Groups underneath                                                                                                 | Same column in the same order: Audio, Messages, Logo (where ProPresenter has Props), Announcements, Slide, Media, Video Input. Each turns dark red while its layer is live. Clear All is the bar between the preview and the column, dark red while anything is up (brighter under the pointer); click anywhere on it. Clear Groups clear several layers at once.                                                                                                 |
| Screen picker, transport, and Audio / Timers / Stage / Messages / Props tabs                                                                                                           | Same. The Audio tab is the audio bin.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Edit: slide list with group headers, Objects, canvas with rulers, Presentation / Slide inspector                                                                                       | Same. Drag or resize the text box, double-click to type on the slide. The Text tab formats one slide.                                                                                                                                                                                                                                                                                                                                                             |
| Reflow                                                                                                                                                                                 | Type the whole song as text with `[Verse 1]` headers.                                                                                                                                                                                                                                                                                                                                                                                                             |
| File menu: New Presentation, New Playlist, New Library, Import ▸, Export ▸                                                                                                             | Same, in the desktop app's menu bar and under **More ▸ File**. Import has File…, Library…, Media…, PowerPoint or Keynote…, Text from Clipboard… and Import Bible…; Export has Presentation…, Presentation Bundle…, Text…, Slide Images…, Playlist… and Themes…. No Print.                                                                                                                                                                                         |
| Edit menu: Undo, Redo, Cut, Copy ▸, Paste ▸, Duplicate, Delete, Select All, Deselect All, Search, Spelling and Grammar ▸, Transformations ▸                                            | Same, in the menu bar and under **More**. In a text field they work on its text; elsewhere on the selected slides (⌘-click and ⇧-click select more), or the presentation or playlist item selected in the sidebar.                                                                                                                                                                                                                                                |
| Presentation menu: New Slide, Next/Previous Slide and Background, Clear Groups ▸, the Clear items, Clear to Logo, Show Triggered…, Reveal in Library, Show Slide on Stage Screens Only | Same, in the menu bar and under **More**, with the same function keys. Clear Logo (F4) stands where ProPresenter has Clear Props.                                                                                                                                                                                                                                                                                                                                 |
| Screens menu: Audience (Enable, Live ▸, Edit Looks…), Stage (Enable, Edit Layouts…), Configure Screens…, Start Capture, Capture Settings…                                              | Same, in the menu bar and under **More ▸ Screens**, with the same keys. See Looks, Stage layouts and Capture below.                                                                                                                                                                                                                                                                                                                                               |
| View menu: Show, Presentation Editor, Reflow Editor, Bibles, Continuous Playlist, Slide View ▸                                                                                         | Same, in the menu bar and under **More ▸ View**, with ProPresenter's Control-key shortcuts. See The View menu below.                                                                                                                                                                                                                                                                                                                                              |
| Grid / Easy / Table buttons under the slides                                                                                                                                           | Same. Easy View shows just the words, large; Table View a row per slide with its picture and words.                                                                                                                                                                                                                                                                                                                                                               |
| Window menu: Minimize, Zoom, Fill, Center, Move & Resize ▸, Full Screen Tile ▸, Bring All to Front, New Windowed Output ▸, the windows                                                 | Same in the desktop app (on a Mac, macOS supplies Fill through Full Screen Tile, as it does for ProPresenter). New Windowed Output is under **More ▸ Window** in a browser too.                                                                                                                                                                                                                                                                                   |
| Right-click menus                                                                                                                                                                      | Same: slides, group headers, the Edit canvas, library and playlist items, playlists, headers and media each have one. See Slides, groups and labels below.                                                                                                                                                                                                                                                                                                        |
| Copy Style / Paste Style (⌥⌘C / ⌥⌘V)                                                                                                                                                   | Same: right-click a slide, or the Text tab's Copy Style and Paste Style buttons. Paste onto one slide, a group, or every slide.                                                                                                                                                                                                                                                                                                                                   |
| Group and Label (right-click a slide), Edit Groups…                                                                                                                                    | Same. Picking a group starts it at that slide. Labels are colored tags on the thumbnails. **Edit Groups & Labels…** sets the lists.                                                                                                                                                                                                                                                                                                                               |
| Transitions                                                                                                                                                                            | Thirteen kinds with direction, length and easing, for a slide (right-click, or its badge), a group, a presentation (the button under the slides), every slide (**Global**, the button under the preview) or media from the media bin.                                                                                                                                                                                                                             |

## Features

- **Library** of songs, scripture and announcements, with search across titles and lyrics. Drop `.txt` lyric files on it to import them.
- **Playlists** for each service, with headers and drag-and-drop ordering. Advancing past the last slide continues into the next item.
- **Slide grid** or list with group colors (Verse, Chorus, Bridge…). Click a slide to put it live.
- **Edit mode** to move and resize the text box, type directly on the slide, and give a slide its own background, formatting, caption and stage notes.
- **Reflow** where the lyrics text is the whole presentation: groups, slides, arrangement, captions and stage notes. Edit-mode changes survive reflowing.
- **Themes** with font, size, colors, shadow, outline, alignment, margins, a lower-third box, and color, gradient or media backgrounds. Text shrinks automatically to fit. In Edit Theme, the Background switch **Media from the Media bin replaces it** can be turned off so the theme's background stays up over media playing from the Media bin (which keeps playing underneath), e.g. scripture on black during a looping video. Per-presentation formatting from the Text button sits on top of the theme.
- **Fonts**: Copperplate from the computer (with a free bundled stand-in), any installed font by name, and font files you add (see below).
- **Copyright line** (title, author, publisher, CCLI song and license numbers) on the first and last slides when "Show On Screen" is on.
- **Transitions**: Cut, Dissolve, Fade, Push, Slide, Reveal, Wipe, Split, Iris, Zoom, Blur, Flip and Cube, with a direction, length and easing, for one slide, a group, a presentation, every slide (global), and media backgrounds. One panel sets any of them, with a preview that plays the transition.
- **Undo and redo** for every change to the library, slides, playlists, themes and messages (see Undo below).
- **Right-click menus** everywhere, **Copy / Paste Text Style**, **group presets** and **slide labels** (see Slides, groups and labels below).
- **Media bin** for images and videos (MP4, MOV, WebM), stored locally in IndexedDB, in media playlists if you like. Videos have a transport (time, scrubbing, ±10 seconds, pause, restart) and loop, stop, clear or play the next one when they end. A video dropped on a slide plays when that slide is shown. Media goes onto slides, but not the other way: dragging a slide (or its picture) into the media bin does nothing; the media bin and the Audio tab only take files from outside Lumen (Finder, the desktop). Click in the media sidebar and ↑/↓ move through its rows (All Media, Images, Videos, Backgrounds…); click an item and the arrow keys move to the one beside, above or below it, showing it as a click would. The item on screen is outlined in gold while you work in the media bin, and gray once you click somewhere else. Drag an item onto another to reorder them (it goes before or after it, by which half you drop it on); in a media playlist that changes the playlist's order. ⌘-click (Ctrl-click) or ⇧-click items to highlight several without showing them; dragging or right-clicking one of them acts on them all, and adding them to a tab or playlist adds only the ones not there yet (a tab they're all in offers to take them out). Right-click ▸ **Show in Finder** (in the desktop app; Explorer on Windows) saves the item as a file in Documents ▸ Lumen ▸ Media (audio: Audio) the first time, and shows it there. Dragging near the top or bottom of any list scrolls it.
- **Layers** as in ProPresenter: Video Input, Media, Slide, Announcements, Logo, Messages and Audio, each cleared on its own or with a **Clear Group** (see Layers below).
- **Audio bin** in the live panel: music and sound effects that play from this computer, loop if you like, and fade out when cleared.
- **Announcements**: a presentation can play on its own layer over the slides, and any presentation can advance by itself (an announcement loop).
- **Video Input**: webcams, capture cards and virtual cameras (OBS, NDI) as a live layer under everything.
- **Countdown timer** (Timers tab, for the stage display only; the audience sees it only through the `{countdown}` message), either a duration or a time of day. It stops at 0:00 (no overtime) and goes back to its length, ready to start again; the stage screen shows 0:00 for 5 seconds, then the timer disappears from it until it's started or reset.
- **Messages** on the audience screen, with `{countdown}` and `{clock}` tokens. Built-in `{countdown}` and `{clock}` messages, always under the new-message box, show the timer or the time on their own. Press Return in a message to show it; Return in the new-message box adds the message and shows it (+ adds it for later).
- **Stage display** showing the current and next slide, notes, clock, timer, and a flashing message to the stage.
- **ProPresenter import** of `.pro` presentations, `.proplaylist` playlists and `.rvbible` Bibles (see below).
- **PowerPoint and Keynote import** into their own library, with their slides editable in Edit mode (see below).
- **Bible mode**, laid out like ProPresenter's (see Bible below), from imported Bibles (offline) or public-domain translations via [bible-api.com](https://bible-api.com).
- **File menu** like ProPresenter's: new presentations, playlists and libraries; import songs, folders, media, text from the clipboard and Bibles; export presentations, bundles, text, slide images, playlists and themes (see The File menu below).
- **Edit menu** like ProPresenter's, for text fields and for slides: select several slides (⌘-click, ⇧-click, Select All) and cut, copy, paste (or paste and match style), duplicate or delete them, or copy and paste their text style (see The Edit menu below).
- **Deleting** that asks first for anything holding other things, goes straight away for a slide, and can always be undone (see Deleting below).
- **Persistence**: everything saves automatically, and Settings backs the whole library up to a file and restores it.

## Slides, groups and labels

**Selecting slides.** Click a slide to show it; ⌘-click or ⇧-click to select more without showing them; or, in Show mode, drag a box over slides from the space around them (⌘ or ⇧ adds to the selection). A click on empty space selects none. Edit's commands and the right-click menu work on all the selected slides.

Right-click a slide (in Show mode's grid or list, or Edit mode's slide list) for:

- **Show Slide**, **Edit Slide**, **Cut / Copy / Paste / Duplicate**, **Insert Blank Slide**, **Delete Slide**. Copied slides paste into any presentation, Bible verses included.
- **Copy Text Style** and **Paste Text Style**: the font, size, weight, color, caps and alignment as the slide shows them (not the text box's position). **Paste Text Style To** puts it on the slide's group or every slide; on every slide it becomes the presentation's formatting. **Clear Text Style** goes back to the theme.
- **Quick Edit** (at the top of a text slide's right-click menu): the slide, larger, in a panel, to type its words in place without leaving Show. They change on the slide as you type (also on screen if it's live), shrinking to fit; Escape, Done or a click elsewhere closes it, and Undo takes the whole edit back.
- **Group**: ProPresenter's list, with its colors: Verse and Verse 1–6, Chorus and Chorus 1–4, Bridge and Bridge 1–3, PreChorus, Tag, Intro, Ending, Outro, Interlude, Vamp, Turnaround and Blank, or **New Group…**. Typed and imported groups get the same colors (Verse 7 takes Verse's). Any group can be given any color: the color well in **Edit Groups…** and in the inspector, or **Color ▸ Any Color…** on a group's right-click menu, opens a color picker (drag for hue and shade, type a hex code, or pick ProPresenter's group colors). As in ProPresenter, a group starts at the slide you pick it on, and the slides after it in its old group come along. Picking a group on a group's first slide renames and recolors that group. **Ungroup** (at the top of the menu, and in the inspector's group menu) works as in ProPresenter: on a group's first slide, the group joins the group of the slide before it (the first group goes grey); on a slide already in the group of the slide before it, that slide and the slides after it in the group go grey (no group). Ungrouping again joins them back to the group before.
- **Label**: a colored tag on the thumbnail, a cue for whoever runs slides (Welcome, Prayer, Offering, Key Change, Last Time…). **Edit…** opens a small panel under the slide: type any name (or pick a saved one from its list) and a color, and it goes on the slides as you type. A new name can be kept with **Save to global labels**. With several slides selected, the label goes on all of them.
- **Transition**: the default, or a kind (by direction, for those that move), a **Duration**, an **Easing**, or **Transition Options…** for the transition panel. A slide with its own transition shows a small badge; click the badge to change it.

Right-click a **group header** in Edit mode to rename it, recolor it, pick a preset, add a slide, duplicate it, paste a text style on all of its slides, give them a transition, or delete it. **Edit Groups & Labels…** (from the Group and Label menus, the Slide inspector or Settings) changes the lists of groups and labels; slides already using one keep theirs.

The Slide inspector in Edit mode has the same choices: the slide's group, its label, and its transition. The Text tab has **Copy Style** and **Paste Style**.

### Transitions

| Kind     | What it does                                    | Directions            |
| -------- | ----------------------------------------------- | --------------------- |
| Cut      | Straight to the next slide                      |                       |
| Dissolve | The next slide fades in as this one fades out   |                       |
| Fade     | This slide fades out, then the next fades in    |                       |
| Push     | The next slide pushes this one off              | ← → ↑ ↓               |
| Slide    | The next slide slides in over this one          | ← → ↑ ↓               |
| Reveal   | This slide slides away, uncovering the next     | ← → ↑ ↓               |
| Wipe     | An edge sweeps across, revealing the next slide | ← → ↑ ↓               |
| Split    | The next slide opens out from the middle        | sideways, up and down |
| Iris     | The next slide opens in a growing circle        |                       |
| Zoom     | The next slide grows in as this one grows away  |                       |
| Blur     | Blurs out, and the next slide comes into focus  |                       |
| Flip     | Turns over like a card                          | ← → ↑ ↓               |
| Cube     | Turns like the sides of a cube                  | ← → ↑ ↓               |

Each has a length (0.1 to 3 seconds) and an easing: **Even**, **Ease In**, **Ease Out** or **Ease In & Out**. Each kind starts with the easing that suits it, such as Even for a wipe and Ease Out for a slide.

The **transition panel** sets them all, with a preview that plays the one you're choosing. Its tabs are the levels a transition can be set at:

- **Slide**: just this slide. Open it by right-clicking a slide, then **Transition ▸ Transition Options…**, by clicking a slide's transition badge, or from the Slide inspector. **Use for All of “Chorus”** and **Use for Every Slide** apply the slide's transition more widely.
- **Group**: every slide in the group. Right-click a group header in Edit mode.
- **Presentation**: every slide in the presentation without its own. Use the button under the slides in Show mode, the Presentation inspector, or right-click the presentation in the library. **Clear Them** removes the slides' own transitions.
- **Global**: every slide of every presentation, unless the presentation or slide has its own. Use the **Global** button under the preview, or Settings. **Use Global Everywhere** clears every presentation's and slide's own transition.
- **Media**: backgrounds from the media bin, as they start, change and clear. Right-click a media item, or use Settings.

A slide comes on screen with its own transition, else its presentation's, else the global one. A background that changes with the slide (a slide's own background, or a different theme's) moves with it, so a Push pushes both. Clearing a layer fades it out. Going through slides faster than their transition (holding an arrow key, or a clicker pressed quickly) doesn't stack them up: a slide still on its way in is cleared when the next one comes, so the words never overlap more than the one change. Messages and the logo fade over the global transition's length. ProPresenter's transitions import as the nearest kind, with their direction and length.

## Undo

**⌘Z** (Ctrl+Z) undoes, **⇧⌘Z** (Ctrl+Shift+Z, or Ctrl+Y) redoes. They're also in **Edit** (in the desktop app's menu bar, or under **More ▸ Edit**), named after the step they'd take ("Undo Delete Slide"). A note at the bottom of the window says what was undone, and in which presentation.

- Each action is one step: deleting, cutting or pasting slides, a group or label, a pasted text style, a transition, a rename, moving a playlist item, an import.
- Typing in a field, or dragging a slider or color, is one step for as long as you keep at it.
- In a text field, ⌘Z undoes the typing, as usual; click outside it to undo whole steps.
- Showing slides, clearing the screen, Bible mode's passage, screen setup, pane sizes and other preferences aren't edits and stay as they are.
- Up to 200 steps, until Lumen is closed. A deleted media file is kept until the next launch, so undoing brings it back.

## Deleting

Everything can be deleted from its right-click menu, its trash button, or the **Delete** (⌫) key:

| What                                   | How                                                                                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| A presentation                         | Select it in the library and press Delete, or its trash button. Lumen asks first, saying which playlists it comes out of and whether it's on screen. |
| An item in a playlist                  | Select it and press Delete: it comes out of the playlist (the presentation stays in the library) and the next item is selected.                      |
| Slides                                 | Select them (⌘-click, ⇧-click for more) and press Delete, or right-click. They go straight away, and the next slide is selected.                     |
| A group                                | Right-click its header in Edit mode. A group of several slides asks first.                                                                           |
| A library or playlist                  | Right-click it, use its trash button, or select it and press Delete. Deleting a library deletes the presentations in it, after asking.               |
| Media, themes, media playlists         | Right-click, or the trash button. Lumen says which slides and themes use the media.                                                                  |
| Imported Bibles, added fonts, a screen | Settings and Screen Configuration. These are files on the computer rather than library edits, so they can't be undone.                               |

Anything else can be undone with ⌘Z, and the note at the bottom of the window says so. Lumen's questions are its own windows (Return answers yes, Escape no), so they work the same in the desktop app, whose web view has no browser dialogs.

## The Edit menu

In the desktop app it's in the menu bar; in a browser it's under **More ▸ Edit**. As in ProPresenter, what each command works on depends on where you are: in a text field, the text; in the library or a playlist, the presentation or entry selected there; anywhere else, the **selected slides**.

Click a slide to select it (in Show mode it also goes live, and the selection follows the slides as you advance). **⌘-click** (Ctrl-click) adds or removes a slide, and **⇧-click** selects the run from the last slide clicked. Selected slides have a blue ring; the live one is orange. Edit mode's slide list selects the same way.

| Command                       | Keys    | On slides                                                                               | In a text field                                                              |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Undo, Redo                    | ⌘Z, ⇧⌘Z | The last change to the library (see Undo)                                               | The typing                                                                   |
| Cut                           | ⌘X      | Copies the selected slides and deletes them                                             | The selected text                                                            |
| Copy ▸ Copy                   | ⌘C      | The selected slides                                                                     | The selected text                                                            |
| Copy ▸ Copy Text Style        | ⌥⌘C     | The first selected slide's font, size, color and alignment                              |                                                                              |
| Paste ▸ Paste                 | ⌘V      | Copied slides, after the selected ones (in any presentation), and selects them          | Text from the clipboard                                                      |
| Paste ▸ Paste and Match Style | ⌥⇧⌘V    | The same, without the copied slides' own formatting, so they look like their neighbours | Plain text                                                                   |
| Paste ▸ Paste Text Style      | ⌥⌘V     | The copied text style onto every selected slide                                         |                                                                              |
| Duplicate                     | ⌘D      | Each selected slide, the copy after it                                                  |                                                                              |
| Delete                        | ⌫       | The selected slides, straight away (Undo brings them back)                              | The selected text                                                            |
| Select All, Deselect All      | ⌘A, ⇧⌘A | Every slide of the presentation, or none                                                | The field's text                                                             |
| Search                        | ⌘F      | Opens Search, for titles and lyrics                                                     | Opens Search                                                                 |
| Spelling and Grammar ▸        |         |                                                                                         | Check Spelling While Typing, and on a Mac the rest of macOS's spelling tools |
| Transformations ▸             |         |                                                                                         | Make Upper Case, Make Lower Case, Capitalize the selected words              |

The right-click menu of a selected slide works on all the selected slides too (**Copy 3 Slides**, **Delete 3 Slides**…). Items that can't run where you are turn grey. On a Mac, macOS adds its own Writing Tools, AutoFill, Start Dictation and Emoji & Symbols at the bottom, as it does to every Edit menu. With a Save or Open panel in front, Edit's commands go to it.

## The File menu

In the desktop app it's in the menu bar; in a browser it's under **More ▸ File**.

- **New Presentation** (⌘N) asks for its name (like New Playlist and New Library), then makes a presentation in the open library with one blank slide in a group called "Group", on no background (transparent, so it shows over whatever media is playing), and opens it in Edit mode, as ProPresenter does. Its **Background** in the Presentation tab can be None (transparent), a color, or the theme's; a slide's own background still wins.
- **New Playlist** and **New Library** ask for a name. Libraries can be renamed (double-click) and deleted like playlists, and a presentation can be moved between them by dragging it onto one or from its **Library** menu.
- **Import ▸**
  - **File…** (⇧⌘I): ProPresenter `.pro` presentations and `.proplaylist` playlists, `.txt` lyrics, `.rvbible` Bibles, PowerPoint `.pptx` and Keynote `.key` files, and Lumen's own exports. Songs go into the open library; PowerPoint and Keynote presentations into the PowerPoint & Keynote library.
  - **Library…**: choose a folder (a ProPresenter library folder, or any folder of `.pro` and `.txt` files). It becomes a new library named after the folder.
  - **Media…**: images (iPhone HEIC photos become JPEG) and videos to the media bin, and audio to the Audio tab.
  - **PowerPoint or Keynote…**: `.pptx` and `.key` presentations (see Importing PowerPoint and Keynote).
  - **Text from Clipboard…**: the copied text in a window, with a title, a library, and where new slides start: at blank lines, or every 1, 2 or 4 lines. `[Chorus]`-style headers make groups. **Paste** reads the clipboard again.
  - **Import Bible…**: a ProPresenter `.rvbible`, for Bible mode.
- **Export ▸** (the first four export the selected presentation; right-click a presentation for them too)
  - **Presentation…**: a `.lumen` file with its slides and the theme it uses. A PowerPoint or Keynote presentation always exports as a bundle, since its slides are pictures.
  - **Presentation Bundle…**: a `.lumenbundle` with the images and videos its slides and theme use as well.
  - **Text…**: the words as `.txt`, with `[Group]` headers, which imports back.
  - **Slide Images…**: every slide as it looks on screen, as JPEG or PNG at 1280×720, 1920×1080 or 3840×2160. The desktop app asks for a folder; a browser downloads a `.zip`.
  - **Playlist…**: the open playlist as a `.lumenplaylist`, with its presentations, themes and media.
  - **Themes…**: the themes you tick, as a `.lumenthemes` file, with their background media.

Importing a Lumen file adds its presentations as new ones (to the open library), and its playlist, themes and media. A theme or media file the library already has is shared rather than copied. Exports save through the system's Save panel in the desktop app, and as downloads in a browser. To move everything to another computer, use **Settings ▸ Back Up Library…** and **Restore Backup…**.

## The Presentation menu

In the desktop app it's in the menu bar, after Edit; in a browser it's under **More ▸ Presentation**.

| Item                                                     | Keys    | What it does                                                                                                                                                |
| -------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New Slide                                                | ⇧⌘N     | A blank slide after the selected one, open in Edit mode                                                                                                     |
| Next Slide, Previous Slide                               | → ←     | As the arrow keys: through the presentation, on into the next playlist item                                                                                 |
| Next Background, Previous Background                     | ⌘→ ⌘←   | The next or previous image or video on the Media layer: in the media playlist it was started from, else the media bin                                       |
| Clear Groups ▸                                           | F1      | **Clear All**, each of your clear groups, and **Configure Clear Groups…**                                                                                   |
| Clear Slide, Media, Logo, Audio, Messages, Announcements | F2–F7   | One layer each. Clear Logo stands where ProPresenter has Clear Props                                                                                        |
| Clear to Logo                                            | F12     | Everything off the screens but the logo (set one in the Props tab first)                                                                                    |
| Show Triggered Presentation, Announcement                | ⌘L, ⇧⌘L | Opens the presentation that's on the slide or Announcements layer, in the playlist or library it was started from                                           |
| Reveal in Library                                        | ⌥⌘L     | Shows the selected presentation in its library                                                                                                              |
| Show Slide on Stage Screens Only                         | ⌘0      | Sends the selected slide to the stage screens (with the slide after it as next) and leaves the audience screens as they are, until the next slide goes live |

The function keys are ProPresenter's: F4 now clears the logo and F6 the messages (they used to be the other way round).

## Videos and the media bin

**Importing.** Press + in the media bin, or drop files on it (or on a slide): images, and videos as MP4 (H.264 plays everywhere), MOV or WebM.

**iPhone photos (HEIC).** HEIC and HEIF photos become ordinary JPEGs as they're added, so every screen, browser and computer can show them. The name stays (`IMG_4821.HEIC` becomes `IMG_4821`), the photo keeps its orientation, and one larger than 4K (3840 pixels on its longest side) is scaled down to that, which is plenty for any projector and keeps the library small. On a Mac (and in Safari) macOS does the converting; elsewhere Lumen loads a HEIC decoder the first time it needs one, which takes a second or two per photo. Files with a `.heic` name, a HEIC type, or HEIC contents under another name are all recognised. Lumen checks each video can be played on this computer and says so if not (an HEVC or ProRes file in a browser without that codec, say). Audio files go to the Audio tab.

**The media bin's own tabs** (Backgrounds, Countdowns, Outro, Logo) fill themselves from names, but you can add and remove anything by hand: drag media onto the tab in the sidebar (or drop files there to import them into it), use **Add from Media Bin** at the top of the tab (or right-click the tab ▸ **Add from Media Bin…**), or right-click an item ▸ **Tabs** and tick or untick a tab. Removing an item from a tab (its trash button there, or untick it) keeps it in All Media. Countdowns and Outro take videos; Backgrounds and Logo, images or videos.

**Backgrounds.** Images and videos to show behind the words have their own **Backgrounds** tab in the media bin, above Countdowns. Ones named like a background ("Background", "Backdrop", "Fondo") go there by themselves, as do items imported while the tab is open; right-click any image or video ▸ **Background** to put it there (or take it out). Removing one in the tab only takes it out of the tab; it stays in All Media.

**Countdowns.** Countdown videos have their own **Countdowns** tab in the media bin (they're in All Media and Videos too). Videos named like one ("Countdown", "Cuenta regresiva") go there by themselves, as do videos imported while the tab is open; right-click any video ▸ **Countdown** to make it one (or not). A countdown holds its last frame when it ends. As it runs out, music on the Audio layer fades to silence over its last seconds (evenly to the ear: halfway through the fade it sounds half as loud) and then clears, and the countdown's own sound fades with it. **Countdown Fade**, at the top of the Audio tab, sets when the music starts to fade (10 seconds before the end by default; 0 stops it at the end without fading) and what sets it off: **Countdown videos**, the **Timer** (the Timers tab's countdown, which has the same switch), or both. If a countdown is cleared (or the timer paused or reset) before its end, the music comes back up. **Play a Random Countdown**, at the top of the Timers tab, puts one of the countdown videos (not the one up now) on the audience screen.

**Outros.** Outro videos, for the end of the service, have their own **Outro** tab in the media bin, under Countdowns. Videos named like one ("Outro", "Despedida", "Closing") go there by themselves, as do videos imported while the tab is open; right-click any video ▸ **Outro** to make it one. One is the **active outro**, marked with a corner bookmark (like a felt one over a page's corner) in the media bin: the first outro, or the one you choose with right-click ▸ **Active Outro**. **Outro**, the button after the gear beside the clear buttons, plays it on the Media layer (again while it's playing: from the start). An outro starting (Play Outro, or clicking one) fades out the music on the Audio layer, so the outro's own sound plays alone. Outros hold their last frame when they end. In **Settings ▸ Outro**, **When the outro ends, show the logo** brings the logo up (clearing the words and the background) as soon as an outro video finishes, and **With the logo, play** starts an audio playlist with it (shuffled, if the playlist is). Removing a video in the Countdowns or Outro tab (its trash button, or right-click ▸ **Remove from Countdowns** / **Remove from Outro**) only takes it out of that tab; it stays in All Media. The Countdowns, Outro and Logo icons and the bookmarks are light blue with the pink highlight and red with the blue.

**Logos.** The **Logo** tab, under Outro, works the same way for logos: images or videos named like one ("Church Logo"), imported while the tab is open, or marked with right-click ▸ **Logo**. The **active logo** has the corner bookmark (right-click ▸ **Active Logo**, the logo button on an item, or the Logo setting chooses it), and **Logo**, the button after Outro, shows it over everything on the audience screen, clearing the slide's words and the background (the Media layer) as it does, or hides it. Showing a slide or putting media up from the media bin takes the logo down. Removing an item in the Logo tab only takes it out of the tab.

**Audio playlists and the Audio Library.** The Audio tab has **Playlists** under Countdown Fade: press **+** to make one, then drag tracks from the Audio list onto it (or onto a track in it, to put them before that one; drag tracks within a playlist to reorder them). Dropping audio files on a playlist imports them into it. Click a track in a playlist to play from there: when it ends the next one plays, and after the last the Audio layer clears, unless the playlist loops (its ↻ button, or right-click ▸ **Loop Playlist**), when it starts over. The ⤨ button (or right-click ▸ **Shuffle**) plays a playlist's tracks in a random order, each once a round; the ▷ button plays a playlist from the top (or, shuffled, from a random track); right-click it to rename, import into or delete it, and right-click a track to remove it. Deleting a playlist keeps its tracks. Drag playlists up or down to reorder them. Only the track playing can loop (its ↻ button, shown while it plays, or right-click ▸ **Loop**): it stops looping when it stops or another track plays. The Audio list is in alphabetical order. **Audio Library**, beside the Audio header, opens a window with every audio file: search them, sort by name (the default), date added or length, play one (▷ or double-click), loop it, see which playlists it's in, **Shuffle** every track in the library, and select several (⇧ or ⌘-click) to **Add to Playlist** (an existing one or a new one). Drop audio files on the window to import them. **Crossfade Songs** (the crossfade button in the Playlists header, or **Settings ▸ Audio**, where a slider sets its length from 1 to 5 seconds) fades each track in a playlist into the next, starting the next one that many seconds before the end, and fades a track you start while another is playing in as the other fades out.

**Playlists.** As in ProPresenter, the media bin's **Playlists** (+ to add one) keep media in an order, e.g. a service's walk-in loop, countdown and offering video. Importing while a playlist is open puts the files in it; drag tiles from All Media onto a playlist to add them; right-click to rename, delete, or take an item out (it stays in All Media).

**Playing.** Click a video to put it on the Media layer, again to clear it. Under the preview, the transport shows how far in it is and how long is left, a slider to scrub, ±10 seconds, pause and play from the start. Every screen follows. Each video's tile shows its length, and right-click → **When It Ends** (or the button in the transport) chooses:

- **Loop**: start again (the default, for backgrounds).
- **Stop on the Last Frame**: hold the end.
- **Clear**: take it off, with the media transition.
- **Play the Next One**: the next video or image in the playlist it was started from (or the media bin), then clear after the last.

A video's own sound (a video from the media bin, an outro, a countdown, a slide's video) plays from this computer's speakers or sound card, from the control window, as the Audio layer does; the screens themselves are silent, so it plays whether or not a projector is connected, and only once.

**Videos on slides.** Drag a video or image from the media bin onto a slide (or drop an MP4 file straight on it) to give the slide a **media cue**, as in ProPresenter: showing that slide starts the video on the Media layer, and it keeps playing through the next slides until other media or a clear. The slide's thumbnail shows the video behind its words, with a film badge (click it to show it now or take it off). Right-click a slide → **Media**, or the Slide inspector's **Media**, picks one from a list too. A slide whose cue is already playing doesn't restart it.

## Layers

The column on the right of the preview clears one layer each, top to bottom as in ProPresenter (there's no Props layer; Lumen's logo sits in its place). A layer's button lights up while it has something on it, and **✕** clears them all (F1).

| Layer         | What's on it                                                                                      | Clear |
| ------------- | ------------------------------------------------------------------------------------------------- | ----- |
| Audio         | A track from the **Audio** tab, playing from this computer. Clearing fades it out.                | F5    |
| Messages      | A message from the Messages tab                                                                   | F6    |
| Logo          | The logo (Props tab, or a media item's right-click menu)                                          | F4    |
| Announcements | A slide from a presentation that plays on Announcements, with its own background, over the slides | F7    |
| Slide         | The slide, and the background that goes with it                                                   | F2    |
| Media         | An image or video from the media bin, in place of slide backgrounds                               | F3    |
| Video Input   | A camera or capture card, underneath everything                                                   |       |

**Clear Groups** sit under the preview: each clears several layers at once, and lights up while any of them is live. Lumen starts with **Clear Text** (slide, announcements and messages, so the background and music keep going), **Clear All but Audio**, and **Clear Media & Audio**. The gear button, or a right-click there, opens **Clear Groups** to add your own with a name, icon and color, and pick its layers.

**Audio.** The **Audio** tab (music note) holds songs and sound effects. Drop files there or press +, then click one to play it and again to stop. The ↻ button or right-click → **Loop** repeats it. While it plays, the transport under the preview shows the time, a position slider, pause and play from the start. Audio plays from the operator computer's speakers or sound card, as in ProPresenter, and so does a video's own sound.

**Announcements.** Right-click a presentation → **Plays On ▸ Announcements**, or set **Plays On** in the Presentation inspector. Its slides then go on the Announcements layer, over whatever slides are up, with their own theme background. Clicking its slides and pressing the arrow keys while it's selected steps the announcements; the lyrics stay where they are. **Auto-Advance** (right-click, or the inspector) moves any presentation to its next slide every so many seconds, and **Loop** starts it again after the last. Choosing a slide by hand restarts the time.

**Video Input.** In the media bin's sidebar, **Video Inputs ▸ Cameras & Capture** lists webcams, capture cards and virtual cameras (OBS, NDI) once you press **Find Cameras** and allow camera access. Click one to put it live under everything; it replaces slide backgrounds, so slides with transparent themes sit on top of the picture, and media from the media bin covers it. Click it again, or its clear button, to take it down. Each output window opens the camera itself. In the desktop app on a Mac, macOS asks once for camera access.

## The View menu

In the desktop app it's in the menu bar, after Screens; in a browser it's under **More ▸ View**. The shortcuts use the Control key on a Mac too, as ProPresenter's do.

| Item                    | Keys | What it does                                                                                                                                    |
| ----------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Show                    | ⌃S   | Show mode                                                                                                                                       |
| Presentation Editor     | ⌃E   | Edit mode, for the selected presentation                                                                                                        |
| Reflow Editor           | ⌃R   | Reflow, for the selected presentation                                                                                                           |
| Bibles                  | ⌃B   | Bible mode                                                                                                                                      |
| Continuous Playlist     |      | With a playlist open, Show mode lists all its presentations one after another, each under its own bar, with the playlist's headers between them |
| Slide View ▸ Grid View  |      | Slide thumbnails as they look on screen                                                                                                         |
| Slide View ▸ Easy View  |      | Just the words, large, white on black, for reading at a glance                                                                                  |
| Slide View ▸ Table View |      | A row per slide: number and group, a picture of it, and its words                                                                               |

The three views are also the buttons under the slides. In a continuous playlist, clicking a slide shows it and selects its presentation; picking a presentation in the sidebar scrolls to it, and the same song twice in a playlist lights up only where it was shown from. In a browser, ⌃E, ⌃R and ⌃B do nothing while you type in a text field (⌃E is end of line on a Mac); the desktop app's menu takes them everywhere, as ProPresenter's does.

## The Window menu

| Item                  | What it does                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Minimize (⌘M), Zoom   | The window in front                                                                                                                                                                  |
| Fill, Center          | Fills the screen (without going fullscreen), or centres the window on it                                                                                                             |
| Move & Resize ▸       | **Halves** and **Quarters** of the screen; **Arrange** puts the window in front and the next one side by side, one above the other, or four in quarters; **Return to Previous Size** |
| Full Screen Tile ▸    | (Mac) Left or Right of Screen, sharing a full-screen space with another app                                                                                                          |
| Bring All to Front    | Every Lumen window in front of other apps                                                                                                                                            |
| New Windowed Output ▸ | Opens a window showing a screen, listed under Audience and Stage. Move it, resize it, capture it with streaming software; close it when done                                         |
| The windows           | Lumen's windows, the one in front checked; pick one to bring it forward                                                                                                              |

On a Mac, Fill, Center, Move & Resize, Full Screen Tile, Remove Window from Set and the window list are macOS's own (macOS 15 and later), with its keys, as for ProPresenter. On Windows and Linux Lumen does them itself. Lumen's window can't get smaller than 1000 × 640, so a half or a quarter of a small screen is as close as it can get. In the desktop app the same items are under **More ▸ Window**; in a browser, which can't move its own window, that has just New Windowed Output, which opens a pop-up window.

## The Screens menu

In the desktop app it's in the menu bar; in a browser it's under **More ▸ Screens**.

| Item                         | Keys | What it does                                                       |
| ---------------------------- | ---- | ------------------------------------------------------------------ |
| Audience ▸ Enable            | ⌘1   | Audience screens on or off                                         |
| Audience ▸ Live: _look_ ▸    |      | Puts a saved look on the audience screens; the live one is checked |
| Audience ▸ Edit Looks…       | ⇧⌘1  | The Looks window                                                   |
| Stage ▸ Enable               | ⌘2   | Stage screens on or off                                            |
| Stage ▸ Edit Layouts…        | ⌘4   | The stage layout editor                                            |
| Configure Screens…           | ⌥⌘1  | Screen Configuration (see Screens below)                           |
| Start Capture / Stop Capture |      | Records an audience screen to a movie file                         |
| Capture Settings…            |      | What to record, where, and how                                     |

Identify Screens has moved into Screen Configuration and the Looks window (**Enable Identify**), as in ProPresenter.

### Looks

A look says what each audience screen shows: which layers (Messages, Logo, Announcements, Slide, Media, Video Input), the slides in a theme of its own (**Presentation**: a lower third for the livestream screen, say, while the projector keeps the full slide), and a **Mask** that leaves only part of the screen showing (4:3 in the middle, letterbox, lower or upper third, left or right half).

**Edit Looks…** lists **Live** and the **Presets**. Changing Live changes the screens straight away; a preset is changed in the window and kept with **Save**. Double-click a preset (or **Make Live**, or pick it from Screens ▸ Live) to put it on the screens. **+** saves Live as a new preset; right-click a preset to rename, duplicate or delete it. The slider at the bottom is how long layers take to fade in and out when the look changes. Looks are undoable and saved with the library.

### Stage layouts

**Edit Layouts…** (⌘4) opens the layout editor in place of the slides, like Edit mode: the layouts down the left with their objects underneath, the layout on a canvas with rulers, and an inspector on the right.

- The toolbar above the canvas adds objects: **Slide** (current or next slide's text, notes or picture, the group name, the presentation title), **Time** (the clock, the countdown timer, the time left in the live video; when either countdown runs out it shows 0:00 for 5 seconds, then disappears), **Message** (the stage message, shown only while there is one), **Text** and **Shape**.
- Drag an object to move it, or its handles to resize it; the arrow keys nudge it (Shift for 10 pixels), ⌘D duplicates it and Delete removes it. Right-click for Bring to Front and the rest.
- The inspector sets the layout's name, background and size, and each object's position, font, size, weight, color, alignment, label and fill.
- **+** makes a blank layout, a copy of the current one, or one from the templates (Current + Next Text, Lyrics & Notes, Current & Next Slide). Right-click a layout to rename, duplicate or delete it.

Each stage screen shows the layout picked for it in the live panel's **Stage** tab (the first layout until one is picked).

### Capture

**Start Capture** records an audience screen, as it looks under the live look, with Lumen's sound: the Audio layer and the live video's own sound. **Capture Settings…** sets:

- **Preset:** save the settings under a name to switch back to them.
- **Source:** which audience screen.
- **Save To:** Downloads, Documents, Desktop, Movies or another folder (desktop app). A browser downloads the file when the capture stops.
- **Codec:** H.264 and H.265 where the computer can record them (H.264 on a Mac and in Chrome or Edge), or WebM. HAP and ProRes are listed, as in ProPresenter, but need encoders a web view doesn't have.
- **Encoding:** ProPresenter's sizes, frame rates and bit rates, from 360p30 (4 Mbps) to 1080p60 (24 Mbps), or **Custom Encoding…**.
- **Audio ▸ Routing…:** which of Lumen's two channels goes to the recording's left and right (**Auto** is left to left, right to right).

While it records, a red dot with the time shows in the toolbar; click it to stop. Files are named by the time they started ("Lumen Capture 2026-10-27 at 19.05.33.mp4") and never replace another file.

The capture draws the screen itself (backgrounds, the slide, announcements, messages, the logo, a camera, with their fades), so it records what the screen shows, but slide transitions other than dissolves come out as dissolves.

## Screens

Open **Configure Screens…** from the Screens menu (desktop app), the More menu, Settings, a right-click on the Audience or Stage button, or ⌥⌘1 (Ctrl+Alt+1).

- **Audience and Stage.** Each kind has an on/off switch (the same as the toolbar buttons, ⌘1 and ⌘2) and a **+** to add screens. A screen has a name, a 1920×1080 canvas and a **Screen Color** shown behind everything.
- **Mode and Outputs.** The menu under the screen name sets how a screen's outputs work together:
  - **Single:** one output.
  - **Mirror:** every output shows the whole picture, for example a projector and a lobby TV.
  - **Grouped:** the outputs sit side by side (set **Columns** for rows of them) and make one large screen. Two 1920 x 1080 outputs make a 3840 x 1080 screen, and each shows its half.
  - **Edge Blend:** like Grouped, but neighbouring projectors overlap by **Overlap** pixels and fade into each other there. The fade is gamma-corrected (**Gamma**, 2.2 suits most projectors) so the overlap is as bright as the rest of the picture.

  The tiles show each output where it sits, and whether it's showing.

- **Hardware → Output.** The menu matches ProPresenter's:
  - **System:** connected displays, with a thumbnail of how they're arranged.
  - **NDI** and **Syphon:** listed, but not available yet (see the roadmap).
  - **Placeholder:** reserves an output for a display that isn't there yet, at a size you pick. It shows nowhere.
  - **Disconnected: E65-E0:** an assigned display that's unplugged. The output comes back when that display is plugged in again, matched by name and size.

  Lumen also offers **Automatic**, which uses a display other than the one Lumen's controls are on, external screens first. Displays are listed by the name they report over HDMI or DisplayPort (for example "E65-E0"), with their resolution and refresh rate.

- **Hardware → Output Target.** **Full** fills the display. **2 x 1**, **2 x 2** and **3 x 1** split one display's signal into regions; pick which region the output fills. **Custom** takes a pixel rectangle. This is for multi-display adapters such as a Matrox TripleHead2Go or a Datapath box, which take one wide signal and feed several projectors. Outputs that share a display share one window, each drawn in its region.
- **Video Delay** holds the picture back by up to 120 frames, to line up with a delayed camera feed.
- **Color.** Brightness, contrast, saturation and hue for that output alone, to match a projector to the TVs.
- **Corner Pin.** Drag the corners, or type pixel positions, to straighten a projector that hits the screen at an angle.
- **Alpha Key** (audience). **Fill** sends lyrics, messages and logo without backgrounds; **Key** sends their white silhouette on black. Use a Fill output and a Key output into a video switcher's key input.
- **Identify Screens** puts each screen's name and output on its display. **Test Patterns** shows color bars, an alignment grid, a checkerboard, a gray ramp, white or black on every screen or just one.

**About HDMI.** Computers report a display's name, size, refresh rate and whether it's built in, but not which cable or port it uses, so Lumen can't tell HDMI apart from DisplayPort, USB-C or an adapter. It shows "External (HDMI, DisplayPort, USB-C…)" for every screen that isn't built in. Set the display to extend the desktop, not mirror it, in the computer's display settings, or there is no second screen to send output to. Wireless displays (AirPlay, Miracast) work the same way once they extend the desktop.

**Browser vs desktop app.** The desktop app opens, moves and closes output windows by itself whenever displays change. A browser closes and updates windows by itself, but can only open them when you click. After a reload, or after a screen is plugged in, click the Audience or Stage button again; it turns orange when outputs are waiting to open. Chrome and Edge can list your displays and open outputs fullscreen on them once you allow it with **Detect Screens**. Firefox and Safari can't, so drag the window to the projector there.

## Importing from ProPresenter

Use **File ▸ Import ▸ File…** (⇧⌘I), the import buttons in the Library and Playlist headers, or drag files onto the sidebar. You can select many files at once. **Import ▸ Library…** brings in a whole ProPresenter library folder as a new library.

| File                                     | What comes across                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.pro` (ProPresenter 7 presentation)     | Title, groups with their names and colors, slide text (from every text box), slide notes, the selected arrangement, CCLI details (author, publisher, year, song number, "show on screen"), the transition (kind, direction and length), slide labels with their colors, and each slide's text boxes. A slide with one text box in one format becomes a Lumen text slide in that box's place, font, size, color and alignment (the format most slides use is the presentation's). A slide with several boxes, or mixed fonts, sizes or colors in a box, is kept laid out as it was, over whatever is behind it, and edits like a PowerPoint slide (double-click it). Backgrounds and media don't import; your Lumen theme supplies them. |
| `.proplaylist` (ProPresenter 7 playlist) | Each playlist inside (folders included) with its headers and songs in order. Songs come from the copies bundled in the file and import like `.pro` files, using the arrangement the playlist item chose. Media cues and placeholders are skipped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `.rvbible` (ProPresenter Bible)          | The whole translation, stored on this computer so lookups work offline. Pick it in **Bible** mode and type references in the Bible's language or in English: `Juan 3:16-18`, `Sal 23`, `1 Co 13`, `John 3:16`. Manage imported Bibles in Settings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `.txt`                                   | Lyrics in the Reflow format below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Songs already in your library (same title and slides) are reused rather than duplicated, so re-importing is safe. ProPresenter 6 files (`.pro6`) aren't supported yet. Bible text and media stay on the computer; library backups don't include them. Check that your licence covers projecting the translations you import.

## Importing PowerPoint and Keynote

Use **File ▸ Import ▸ PowerPoint or Keynote…**, **Import ▸ File…**, or drag `.pptx` and `.key` files onto the sidebar. They go into the **PowerPoint & Keynote** library (it's made again if you deleted it), whichever library is open.

- **PowerPoint (`.pptx`)**, from PowerPoint, Google Slides or Keynote's export, on any computer. Lumen reads the file and draws each slide as a 1920×1080 picture: the slide master's and layout's shapes, backgrounds (colors, gradients, pictures), shapes and drawn outlines, groups, pictures with their crops, and text with its fonts, sizes, colors, bullets and numbering, spacing and alignment. Animations, videos, charts and SmartArt aren't drawn, and fonts the computer doesn't have fall back to similar ones (install the presentation's fonts for the closest match). A slide that isn't 16:9 sits in the middle on black.
- **Keynote (`.key`)**, in the Mac desktop app with Keynote installed. Lumen asks Keynote to export the slides as pictures, and a PowerPoint copy to edit them from; the first time, macOS asks whether Lumen may control Keynote (change it later in **System Settings ▸ Privacy & Security ▸ Automation**). Elsewhere, export from Keynote with **File ▸ Export To ▸ PowerPoint** and import that.

Each slide keeps its words (top to bottom), which **Search** finds and the stage display's Current and Next Slide Text show, and its speaker notes as the slide's notes for the stage. PowerPoint's sections become groups; otherwise the slides are in one group. Hidden (skipped) slides are left out. PowerPoint 97–2003 `.ppt` files can't be read; save them as `.pptx` first.

### Editing PowerPoint and Keynote slides

Open a slide in **Edit** (double-click it, or the Edit button). Instead of Lumen's text box, the slide's own shapes, pictures and text boxes are there to change:

- **Click** a shape, picture or text box to select it; **drag** it to move (it snaps to the middle of the slide, with a yellow guide; ⌘ or Ctrl moves it freely; arrow keys nudge, Shift by 10; **Center** in the toolbar, right-click menu or inspector centers it), drag the **handles** to resize (Shift, and pictures, keep their shape) and the round handle above to **turn** it (Shift: 15° steps). The slide's design (its master and layout: backgrounds, bands, logos) stays put and can't be selected.
- **Double-click** a text box (or press Return) to type in it. Its fonts, sizes and colors stay as they are; select words and use **B**, **I**, **U** or a color swatch in the inspector to change just them. Click outside or press Escape when done.
- The inspector's **Shape** tab has the position, size and angle; Front, Forward, Backward and Back; the text's font, size, color, bold, italic, underline, alignment and vertical alignment (for the whole box); and fill and line colors. With nothing selected it's **Slide Design**, with the slide's background color.
- The buttons above the slide add a **text box**, a **shape** (rectangle, rounded rectangle, oval, triangles, line) or a **picture** (from a file or the media bin).
- Edit's **Cut**, **Copy**, **Paste**, **Duplicate** and **Delete** (and the keys) work on the selected shape, or on the slide when nothing is selected. Right-click a shape for them, and for its order.

Each change is one step to undo, and redraws the slide's picture, so thumbnails, the stage and the screens show it straight away (also while it's live). The slide's words for search and the stage come from its text as it now is.

Slides can be added (**Insert Blank Slide** gives one with the same design), duplicated, deleted, cut, copied and pasted, moved between groups and reordered like any slide; a copied slide takes its PowerPoint file along, so it can be edited in another presentation too. **Reflow** stays off for these presentations, since their slides are pictures rather than text.

Keynote slides are edited from Keynote's PowerPoint copy, so a slide may look slightly different from Keynote's own picture once it's changed. Keynote presentations imported before editing came in have no PowerPoint copy yet: Edit offers **Make Editable with Keynote** (Mac, with Keynote).

## Bible

Click **Bible** in the toolbar. The slides area turns into ProPresenter's Bible view; the library, playlist and live panel stay where they are.

- **Passage:** type a reference (`Génesis 25:30-34`, `Jn 3:16`, `Psalm 23`), or pick **Book › Chapter › Verse** from the menu beside it. **Whole chapter** is at the top of each chapter's verses. **Search** finds verses containing every word you type (imported Bibles).
- **Translation, Verse, Reference:** the first menu picks the translation. **Verse** and **Reference** pick which box of the template each goes into (each option shows a thumbnail of where that box sits), or **None**. **+** adds a second or third translation, lined up verse by verse, for bilingual services. **License** shows the translation's terms.
- **Slides:** one per verse, in the template, labelled like `Génesis 25:30`. Click one to show it; <kbd>→</kbd> and <kbd>←</kbd> step through the verses on screen. Typing the next reference doesn't change what's on screen until you click a slide. **‹ Verse** and **Verse ›** move to the verse before or after the passage.
- **Options › Slide Options:** **Show Verse Numbers** (as small superscripts), **Break on New Verse** (off: fill each slide with as many verses as fit), **Display Translation** (add the abbreviation to references), and where references go: **Verse References** (each slide its own verses), **Passage Each** (the whole passage on every slide), **Passage Last** or **No Reference**. **Theme** picks the template, **Edit…** opens it, and **Import Library** is where saved passages go. **Options › Bibles** imports and removes Bibles.
- **Save As…:** save the passage as a presentation (name it and pick a library), **Copy to Selected Presentation** (append it to the presentation selected in the library, such as a sermon), or **Save to Playlist ›**.

**The verse template.** The **Bible** theme matches ProPresenter's: the verse in a **Verse** box in the middle (Copperplate) and the reference in its own **Reference** box at the bottom right, on a transparent background. Any theme can have that second box: in the theme editor, under **Text boxes**, name the main box and turn on **Caption box** to give captions their own position, font, size, color and alignment. Saved Bible slides keep the reference as the slide's caption (`~ Génesis 25:30` in Reflow), so they display in that box wherever they're shown.

Translations online (WEB, KJV, ASV, BBE, YLT, Darby) need the internet and work with the same menus, using standard chapter and verse counts.

## Fonts

Every font menu lists the system fonts, the fonts bundled with Lumen, and any you have added, plus **Font installed on this computer…** to use any other installed font by name.

- **Copperplate** (the ProPresenter favourite) is a commercial font, so it can't ship inside Lumen. Lumen uses the copy on the computer instead: every Mac has Copperplate, and Windows with Microsoft Office has Copperplate Gothic. Where neither is installed, Lumen shows **Cinzel**, a free font bundled with the app that likewise sets lowercase letters as small capitals. Settings → Fonts says which one this computer is using. There's also a ready-made **Copperplate** theme.
- **Add font files** you're licensed to use (`.ttf`, `.otf`, `.woff`, `.woff2`, or `.ttc` collections) in Settings → Fonts, or with **Add font file…** in any font menu. They're stored on the computer and load in the audience and stage windows too.
- **Imported ProPresenter songs keep their font**, size, color and alignment. Songs set in Copperplate also get the Copperplate theme.

To bundle another open-licensed font in the code, install it from [Fontsource](https://fontsource.org) (for example `npm install @fontsource/montserrat`), import its CSS in `src/main.tsx` next to Cinzel, and add an entry to `BUNDLED_FONTS` in `src/fonts.ts`.

## Writing lyrics

```text
[Verse 1]
Amazing grace! How sweet the sound
That saved a wretch like me!

I once was lost, but now am found;
Was blind, but now I see.
> Band drops out here

[Chorus]
...

[Verse 2]
...

[Chorus]
```

| Syntax                         | Meaning                                                |
| ------------------------------ | ------------------------------------------------------ |
| `[Name]`                       | Starts a group. Its color comes from the name.         |
| blank line                     | Starts a new slide                                     |
| `[Name]` with nothing under it | Repeats an earlier group in the arrangement            |
| `~ text`                       | Caption under the slide, such as a scripture reference |
| `> text`                       | Note shown only on the stage display                   |

## Keyboard

| Key                            | Action                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `→` `Space` `PgDn`             | Next slide                                                                                                                                                                                                       |
| `←` `PgUp`                     | Previous slide                                                                                                                                                                                                   |
| `↓` / `↑`                      | The slide directly below / above the one on screen in the grid (the next / previous in Table View). With a library or playlist list clicked (its selection is pink then, grey otherwise), the item below / above |
| `C`, `V`, `B`, …               | Jump to the next group starting with that letter                                                                                                                                                                 |
| `F1`                           | Clear all                                                                                                                                                                                                        |
| `F2` / `F3` / `F4`             | Clear slide / media / logo                                                                                                                                                                                       |
| `F5` / `F6` / `F7`             | Clear audio / messages / announcements                                                                                                                                                                           |
| `F12`                          | Clear to logo: everything off but the logo                                                                                                                                                                       |
| `⌘←` / `⌘→`                    | Previous / next background from the media bin (its playlist, if it was started from one)                                                                                                                         |
| `⇧⌘N`                          | New slide                                                                                                                                                                                                        |
| `⌘L` / `⇧⌘L` / `⌥⌘L`           | Show the triggered presentation / announcement; reveal the selected presentation in its library                                                                                                                  |
| `⌘0`                           | Show the selected slide on the stage screens only                                                                                                                                                                |
| `⌘1` / `⌘2` (Ctrl on Windows)  | Audience / Stage screens on or off (browsers may keep these for switching tabs)                                                                                                                                  |
| `⌥⌘1` (Ctrl+Alt+1)             | Configure Screens                                                                                                                                                                                                |
| `⇧⌘1` (Ctrl+Shift+1)           | Edit Looks                                                                                                                                                                                                       |
| `⌘4` (Ctrl+4)                  | Edit stage layouts                                                                                                                                                                                               |
| `⌃S` / `⌃E` / `⌃R` / `⌃B`      | Show / Presentation Editor / Reflow Editor / Bibles (Control on a Mac too)                                                                                                                                       |
| `⌘Z` / `⇧⌘Z` (Ctrl+Z / Ctrl+Y) | Undo / redo                                                                                                                                                                                                      |
| `⌘X` `⌘C` `⌘V` `⌘D` (Ctrl)     | Cut, copy, paste, duplicate the selected slides (any mode)                                                                                                                                                       |
| `⌘A` / `⇧⌘A`                   | Select all / deselect all slides                                                                                                                                                                                 |
| `⌥⇧⌘V`                         | Paste and match style                                                                                                                                                                                            |
| `⌘F`                           | Search                                                                                                                                                                                                           |
| `⌘N` (Ctrl+N)                  | New presentation (in a browser, only where the browser lets the key through)                                                                                                                                     |
| `⇧⌘I` (Ctrl+Shift+I)           | Import a file                                                                                                                                                                                                    |
| `Delete` / `⌫`                 | Delete the selected slides, presentation, playlist item, or library                                                                                                                                              |
| `⌥⌘C` / `⌥⌘V` (Ctrl+Alt+C/V)   | Copy / paste the selected slides' text style                                                                                                                                                                     |

Clickers that send arrow keys or Page Up/Down work out of the box. In Edit mode, the arrow keys nudge the selected text box (Shift for 10px), Enter starts typing, and Escape deselects. A new slide opens with its text box selected, its eight handles showing, and takes the Text Style of the slide it's added after (the last slide, for the + under the slides), so it matches the rest of the song. In the Text inspector, **Apply to All Slides** gives every slide the Text Style of the slide you're on, and **Reset to Theme** puts that slide back to the theme's look. Dragging a text box snaps it to the middle of the slide, with a yellow guide line while it's there (hold ⌘ or Ctrl to move it freely); the **Center** button in the floating toolbar, right-click ▸ **Center on Slide**, and **Center / Horizontally / Vertically** under Position in the Text inspector put it in the middle.

## How it works

```
src/
  types.ts         data model: presentations, themes, playlists, live state, output frame
  store.ts         Zustand store: library, playlists, slide editing, live control, timer (saved to localStorage)
  lyrics.ts        text ⇄ groups/slides/arrangement parser
  history.ts       undo and redo: each store action is a step, typing joins into one, names for the Edit menu
  slideOps.ts      slide and group edits shared by menus, inspector and keys: assign a group, paste a text style, transitions
  transitions.ts   transition kinds, which one a slide uses, labels, mapping ProPresenter's effects
  labels.ts        group presets and slide labels
  layers.ts        the layers in clear-column order, clearing them, and the default Clear Groups
  heic.ts          recognising HEIC photos and converting them to JPEG (natively, or with libheif)
  theme.ts         theme → presentation → slide formatting, backgrounds, copyright line
  fonts.ts         font menus, Copperplate fallback chain, reading font files, loading added fonts
  bible.ts         imported and online Bibles: storage, reference parsing (local + English book names), lookups
  bibleSlides.ts   Bible mode's slides: verses into the template's boxes, references, verse numbers, parallel translations
  versification.ts chapter and verse counts of the 66 books, for online translations
  commands.ts      new presentation, file import (ProPresenter files, lyrics, Bibles, slideshows and Lumen's own)
  slideshows.ts    PowerPoint and Keynote presentations: their slides' words, the files they keep, which file a slide edits from
  slideshowImport.ts  importing them: drawing PowerPoint slides, having Keynote export its slides, the library
  deck.ts          Lumen's model of a PowerPoint deck: shapes, pictures and text, resolved from masters and layouts
  deckRender.ts    draws a deck's slides onto a canvas (shapes, gradients, pictures, wrapped text, bullets)
  deckEdit.ts      editing a deck slide: hit-testing, moving, resizing and turning, restacking, new shapes, text formatting
  deckSlides.ts    a slide's model to edit (saved, or from its PowerPoint file), saving it and redrawing its picture
  deckTextDom.ts   a text box as HTML for typing in it, and back
  fileFormats.ts   Lumen's export files (.lumen, .lumenbundle, .lumenplaylist, .lumenthemes): writing, reading, importing
  slideImages.ts   drawing slides onto a canvas for Export ▸ Slide Images
  looks.ts         looks: which layers each audience screen shows, its theme and mask
  stageLayouts.ts  stage layouts: the kinds of object, the templates, moving and resizing
  updates.ts       the Update button's state: checking at start-up and every six hours, installing
  capture.ts       Screens ▸ Capture: drawing an audience screen onto a canvas, its sound, recording to a file
  import/          readers for ProPresenter .pro (protobuf + RTF), .proplaylist and .rvbible (zip of USX books),
                   PowerPoint .pptx (pptx.ts, with a small XML reader in xml.ts),
                   and a zip reader that tolerates ProPresenter's Zip64 layout
  frame.ts         derives the OutputFrame from the store
  sync.ts          sends frames from the operator window to output windows (desktop app events or BroadcastChannel)
  desktop.ts       connects the shared code to the desktop app (window.lumenDesktop)
  liveFrame.ts     pushes each new frame to output windows and the operator's monitor
  media.ts         IndexedDB storage for images and videos
  screens.ts       screen setup: matching outputs to displays, corner pin and color math
  outputs.ts       display detection and hot-plug, opening and closing output windows (desktop app windows or browser popups)
  components/
    ControlApp     window layout per mode and keyboard shortcuts
    fileCommands   the File menu: New, Import and Export, saving through the desktop app or downloads
    presentationCommands  the Presentation menu: its commands, function keys and desktop menu state
    UpdateDialog   the Update button's window: the token, what's new, Install and Restart
    windowCommands the Window menu: New Windowed Output, and More ▸ Window
    viewCommands   the View menu: modes, Continuous Playlist and Slide View, their keys and desktop menu state
    screensCommands  the Screens menu: its commands and keys, and the desktop menu's checkmarks and looks
    LooksDialog    the Looks window (Edit Looks…)
    StageLayoutsEditor  the stage layout editor (Edit Layouts…)
    CaptureDialog  Capture Settings, and the capture's time
    editCommands   the Edit menu: what each command does in a text field, a list or the selected slides; its keys;
                   slide selection; keeping the desktop menu's items on and off
    FileDialogs    Text from Clipboard, Export Slide Images and Export Themes windows
    Ask            Lumen's own confirm, prompt and alert boxes (the desktop web view has none)
    deleting       deleting each kind of thing: what it asks, and the Delete key's notes
    Toolbar        ProPresenter-style toolbar with Search / Text / Theme popovers and the More menu
    Sidebar        Library and Playlist collections with their items
    ShowView       slides in Grid, Easy or Table View, and the continuous playlist
    MediaBin       media sidebar (media, playlists, video inputs) and bin, importing with a playability check
    MediaClock     keeps time for the live video in the operator window: transport and what happens at its end
    LivePanel      preview, clear column, transport, Audio / Timers / Stage / Messages / Props
    ClearGroups    the Clear Groups row and its window
    AudioTab, AudioPlayer  the audio bin, its playlists and Audio Library, and the player for the Audio layer (with its fade-out)
    EditView       slide outline, canvas editor with rulers, inspector
    DeckEditor     Edit mode for PowerPoint and Keynote slides: their shapes on a canvas, typing in place, the Shape inspector
    ReflowView     lyrics text editor
    Canvas         1920×1080 canvas, auto-fitting text, layered output, transitions
    ScreenConfig   Screen Configuration window
    MenuSelect     ProPresenter-style pop-up menus (checkmarks, headers, submenus, thumbnails)
    ContextMenu    right-click menus and small floating panels (name and color, transition picker)
    menus          what each right-click menu offers
    TransitionPicker  transition panel (Slide / Group / Presentation / Global / Media tabs) with a live preview,
                   and the buttons that open it
    ScreenHostApp  output window (#/screen): every output on one display, each in its region, with its share of a
                   grouped screen, edge blend, delay, color, corner pin, identify and test patterns.
                   #/output and #/stage show the first audience or stage screen, e.g. as a browser source in OBS
    StageView      a stage screen: its layout's objects
    BibleView      Bible mode: passage, translations, Verse/Reference boxes, options, slides, Save As
    ThemeEditor, Dialogs
src-tauri/          the desktop app (Tauri, Rust)
  src/displays.rs  display list with real names (macOS: from AppKit), hot-plug watcher
  src/outputs.rs   output windows: one fullscreen per display, or a window per output without one
  src/camera.rs    lets the web views open cameras (Video Input)
  src/menu.rs      menu bar: File (New, Import, Export), and where the other menus go
  src/view.rs      the View menu
  src/updates.rs   the Update button: the GitHub token, finding a newer release, installing it
  src/window.rs    the Window menu: moving and arranging windows, New Windowed Output, the window list
  src/screens.rs   the Screens menu, with the looks listed under Live
  src/capture.rs   capture files: Save To's folders, writing the recording as it comes
  src/startup.rs   Settings ▸ Startup: opening Lumen at login (tauri-plugin-autostart)
  src/keynote.rs   Keynote files (macOS): has Keynote export the slides as pictures and a PowerPoint copy, with their words and notes
  src/presentation.rs  the Presentation menu, with the operator's clear groups listed in Clear Groups
  src/edit.rs      the Edit menu: its items on and off, Undo and Redo named after the next step, macOS's own
                   Spelling and Grammar and Transformations, and Edit's commands for a Save or Open panel in front
  src/files.rs     Open and Save panels, the slide-image folder, and the clipboard, for the File menu
  src/icon.rs      app icon choice: Dock on macOS, window icons elsewhere, remembered on disk
  icons/           the packaged app's icon (Projector) and the four choices
design/icons/      .svg sources of the four icons
public/icons/      browser tab, home-screen and picker images for each icon
```

The operator window owns all state. Every change produces an `OutputFrame`, a self-contained description of what each screen should show, which goes to the output windows (as desktop app events, or over `BroadcastChannel` in a browser). Output windows hold no library data. They render the frame and load media from the IndexedDB they share with the operator window. Every view renders onto the same fixed 1920×1080 canvas and scales it, so text wraps the same way in thumbnails, the monitor and the projector.

## Third-party code

HEIC photos are decoded with [libheif](https://github.com/strukturag/libheif), through [heic-to](https://github.com/hoppergee/heic-to), both under the LGPL 3.0. They're built into a file of their own (`dist/assets/heic-to-*.js`) that loads only when a HEIC photo is added, and can be replaced with another build of the same library. Cinzel is under the SIL Open Font License. The color picker is [react-colorful](https://github.com/omgovich/react-colorful) (MIT).

## Roadmap ideas

- Multiple arrangements per song
- More objects in Edit (extra text boxes, shapes, images), and slide builds
- Slide hotkeys
- Audio bin and video playback with sound and transport controls
- Remote control from a phone over WebSocket
- NDI and Syphon outputs (listed in Screen Configuration's Output menu), or capture-card output for livestreams
- Import ProPresenter 6, media bundled in playlists, OpenLP, OpenSong, CCLI SongSelect and Planning Center
- Export to ProPresenter's own `.pro` format
- CCLI usage reporting
- Signed and notarized installers, and automatic updates
