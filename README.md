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

Click **Audience** or **Stage** in the toolbar to open the output windows. In Chrome or Edge, open **Screens → Configure Screens…** (More menu, or right-click Audience) and press **Detect Screens** once: the outputs then open fullscreen on your TV or projector by themselves. In other browsers, drag the window to the projector and double-click it for fullscreen.

### As a desktop app (Electron)

The desktop shell opens each output fullscreen on its display, with no browser chrome, and adds ProPresenter's **Screens** menu (⌘1 Audience, ⌘2 Stage, ⌥⌘1 Configure Screens…, Identify Screens). Outputs come up as soon as an HDMI cable goes in and return when an unplugged screen is reconnected.

```sh
npm run electron     # build, then launch the desktop app
# or, while developing:
npm run dev          # terminal 1
npm run electron:dev # terminal 2, loads the dev server with hot reload
```

### Other scripts

```sh
npm test             # unit tests (Vitest)
npm run typecheck
npm run build        # production build into dist/
npm run format       # Prettier
```

## Where things are (for ProPresenter users)

| ProPresenter                                                                                     | Lumen                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolbar: Search · Text, Theme · Show, Edit, Reflow, Bible, More                                  | Same buttons, same order. Text and Theme drop down panels that apply to the selected presentation.                                                                                                                                                 |
| Toolbar: Media, Audience, Stage                                                                  | Media toggles the media bin. Audience and Stage turn those screens on or off; the ring is green when they're showing and orange when some outputs aren't. Right-click either one to configure screens.                                             |
| Screens menu and Screen Configuration (⌥⌘1)                                                      | Same layout: Audience and Stage lists with on/off switches and +, Identify Screens, Test Patterns, then per screen its name, size, Screen Color, Outputs, the output tiles, and Hardware / Color / Corner Pin / Alpha Key tabs. See Screens below. |
| Library and Playlist at the top left, items below with a Filter                                  | Same. Libraries are Songs, Scripture, Announcements and Other. Drag a presentation onto a playlist name to add it.                                                                                                                                 |
| Slide grid with numbered, colored group labels                                                   | Same. Click a slide to go live (orange border), double-click to edit it.                                                                                                                                                                           |
| Media bin along the bottom                                                                       | Same, with All Media / Images / Videos on the left. Click an item to play it behind the slides.                                                                                                                                                    |
| Preview with clear buttons on its right edge, ✕ for Clear All                                    | Same: Messages, Logo, Slide and Media clear buttons light up while their layer is live.                                                                                                                                                            |
| Screen picker, transport, and Stage / Timers / Messages / Props tabs                             | Same.                                                                                                                                                                                                                                              |
| Edit: slide list with group headers, Objects, canvas with rulers, Presentation / Slide inspector | Same. Drag or resize the text box, double-click to type on the slide. The Text tab formats one slide.                                                                                                                                              |
| Reflow                                                                                           | Type the whole song as text with `[Verse 1]` headers.                                                                                                                                                                                              |

## Features

- **Library** of songs, scripture and announcements, with search across titles and lyrics. Drop `.txt` lyric files on it to import them.
- **Playlists** for each service, with headers and drag-and-drop ordering. Advancing past the last slide continues into the next item.
- **Slide grid** or list with group colors (Verse, Chorus, Bridge…). Click a slide to put it live.
- **Edit mode** to move and resize the text box, type directly on the slide, and give a slide its own background, formatting, caption and stage notes.
- **Reflow** where the lyrics text is the whole presentation: groups, slides, arrangement, captions and stage notes. Edit-mode changes survive reflowing.
- **Themes** with font, size, colors, shadow, outline, alignment, margins, a lower-third box, and color, gradient or media backgrounds. Text shrinks automatically to fit. Per-presentation formatting from the Text button sits on top of the theme.
- **Fonts**: Copperplate from the computer (with a free bundled stand-in), any installed font by name, and font files you add (see below).
- **Copyright line** (title, author, publisher, CCLI song and license numbers) on the first and last slides when "Show On Screen" is on.
- **Per-presentation transitions**: cut or fades of different lengths.
- **Media bin** for images and looping videos as backgrounds, stored locally in IndexedDB, with pause and restart.
- **Layers** as in ProPresenter: background, slide, message and logo, each cleared on its own, with crossfade transitions.
- **Countdown timer**, either a duration or a time of day, shown on the stage display and usable in messages.
- **Messages** on the audience screen, with `{countdown}` and `{clock}` tokens.
- **Stage display** showing the current and next slide, notes, clock, timer, and a flashing message to the stage.
- **ProPresenter import** of `.pro` presentations, `.proplaylist` playlists and `.rvbible` Bibles (see below).
- **Bible** lookups from imported Bibles (offline, with book and chapter pickers) or public-domain translations via [bible-api.com](https://bible-api.com), or paste any text.
- **Persistence**: everything saves automatically, and the library exports to and imports from JSON.

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

Use the import buttons in the Library and Playlist headers, **More → Import**, or drag files onto the sidebar. You can select many files at once.

| File                                     | What comes across                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.pro` (ProPresenter 7 presentation)     | Title, groups with their names and colors, slide text (from every text box), slide notes, the selected arrangement, CCLI details (author, publisher, year, song number, "show on screen"), the transition length, and the font, size, color and alignment most slides use (see Fonts). Text box positions, backgrounds and media don't import; your Lumen theme supplies them. |
| `.proplaylist` (ProPresenter 7 playlist) | Each playlist inside (folders included) with its headers and songs in order. Songs come from the copies bundled in the file and import like `.pro` files, using the arrangement the playlist item chose. Media cues and placeholders are skipped.                                                                                                                              |
| `.rvbible` (ProPresenter Bible)          | The whole translation, stored on this computer so lookups work offline. Pick it in the **Bible** dialog and type references in the Bible's language or in English: `Juan 3:16-18`, `Sal 23`, `1 Co 13`, `John 3:16`. Manage imported Bibles in Settings.                                                                                                                       |
| `.txt`                                   | Lyrics in the Reflow format below.                                                                                                                                                                                                                                                                                                                                             |

Songs already in your library (same title and slides) are reused rather than duplicated, so re-importing is safe. ProPresenter 6 files (`.pro6`) aren't supported yet. Bible text and media stay on the computer; library exports don't include them. Check that your licence covers projecting the translations you import.

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

| Key                           | Action                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `→` `↓` `Space` `PgDn`        | Next slide                                                                      |
| `←` `↑` `PgUp`                | Previous slide                                                                  |
| `C`, `V`, `B`, …              | Jump to the next group starting with that letter                                |
| `F1`                          | Clear all                                                                       |
| `F2` / `F3` / `F4`            | Clear slide / media / message                                                   |
| `F6`                          | Toggle logo                                                                     |
| `⌘1` / `⌘2` (Ctrl on Windows) | Audience / Stage screens on or off (browsers may keep these for switching tabs) |
| `⌥⌘1` (Ctrl+Alt+1)            | Configure Screens                                                               |

Clickers that send arrow keys or Page Up/Down work out of the box. In Edit mode, the arrow keys nudge the selected text box (Shift for 10px), Enter starts typing, and Escape deselects.

## How it works

```
src/
  types.ts         data model: presentations, themes, playlists, live state, output frame
  store.ts         Zustand store: library, playlists, slide editing, live control, timer (saved to localStorage)
  lyrics.ts        text ⇄ groups/slides/arrangement parser
  theme.ts         theme → presentation → slide formatting, backgrounds, copyright line
  fonts.ts         font menus, Copperplate fallback chain, reading font files, loading added fonts
  bible.ts         imported Bibles: storage, reference parsing (local + English book names), lookup
  commands.ts      new presentation, file import
  import/          readers for ProPresenter .pro (protobuf + RTF), .proplaylist and .rvbible (zip of USX books),
                   and a zip reader that tolerates ProPresenter's Zip64 layout
  frame.ts         derives the OutputFrame from the store
  sync.ts          BroadcastChannel between the operator and output windows
  liveFrame.ts     pushes each new frame to output windows and the operator's monitor
  media.ts         IndexedDB storage for images and videos
  screens.ts       screen setup: matching outputs to displays, corner pin and color math
  outputs.ts       display detection and hot-plug, opening and closing output windows (browser popups or Electron windows)
  components/
    ControlApp     window layout per mode and keyboard shortcuts
    Toolbar        ProPresenter-style toolbar with Search / Text / Theme / More popovers
    Sidebar        Library and Playlist collections with their items
    ShowView       slide grid and list
    MediaBin       media sidebar and bin
    LivePanel      preview, clear buttons, transport, Stage / Timers / Messages / Props
    EditView       slide outline, canvas editor with rulers, inspector
    ReflowView     lyrics text editor
    Canvas         1920×1080 canvas, auto-fitting text, layered output, transitions
    ScreenConfig   Screen Configuration window
    MenuSelect     ProPresenter-style pop-up menus (checkmarks, headers, submenus, thumbnails)
    ScreenHostApp  output window (#/screen): every output on one display, each in its region, with its share of a
                   grouped screen, edge blend, delay, color, corner pin, identify and test patterns.
                   #/output and #/stage show the first audience or stage screen, e.g. as a browser source in OBS
    StageView      stage display layout
    ThemeEditor, Dialogs
electron/          desktop shell: display detection, one fullscreen window per output, Screens menu, app:// protocol
```

The operator window owns all state. Every change produces an `OutputFrame`, a self-contained description of what each screen should show, which goes to the output windows over `BroadcastChannel`. Output windows hold no library data. They render the frame and load media from the IndexedDB they share with the operator window. Every view renders onto the same fixed 1920×1080 canvas and scales it, so text wraps the same way in thumbnails, the monitor and the projector.

## Roadmap ideas

- Multiple arrangements per song
- More objects in Edit (extra text boxes, shapes, images), and slide builds
- Slide hotkeys and group color presets shared across songs
- Audio bin and video playback with sound and transport controls
- Remote control from a phone over WebSocket
- NDI and Syphon outputs (listed in Screen Configuration's Output menu), or capture-card output for livestreams
- Import ProPresenter 6, media bundled in playlists, OpenLP, OpenSong, CCLI SongSelect and Planning Center
- CCLI usage reporting
- Installers with electron-builder
