# EverPad

[https://github.com/nihongi/everpad/](https://github.com/nihongi/everpad/)

[English](#english) | [日本語](#日本語)

## English

EverPad is a note-taking app for Windows. You write in plain text or Markdown (tables included), every single edit is kept in the history, and a time slider lets you rewind a note and watch how it was written. It is built with Electron.

The user interface is available in English and Japanese. The language follows the Windows display language (English for anything other than Japanese), and can be changed at any time from View → Language (言語).

This program was created with the help of Claude Code.

### Features

- **Full edit history**: every edit is recorded. Drag the time slider or play the history back to see any past version, and restore it with one click.
- **Markdown preview**: headings, lists, check boxes, code, links, block quotes and tables.
- **Math**: LaTeX math (and chemical formulas) is shown as formatted formulas in the preview, the history and printouts.
- **Search across all notes**: search either the latest version of each note or the entire history, including text that has since been deleted.
- **Find and replace**: with case sensitivity, whole-word and regular-expression options.
- **Images and attachments**: paste screenshots or drop files into a note.
- **Print and PDF**: print a note, or save it as a PDF, with the same formatting as the preview.
- **English and Japanese**: switch the interface language from the menu.
- **Plain files**: notes are stored as ordinary files in a folder you choose, so backing up is just copying the folder.

### Requirements

- Windows 10 / 11 (macOS and Linux builds can be made from the source, but have not been tested; see "macOS and Linux (untested)" below)
- [Node.js](https://nodejs.org/) (LTS, v20 or later)

### Getting started

1. Put the source files anywhere you like.
2. Open PowerShell or Command Prompt in the folder that contains `package.json`.
3. The first time only, install the dependencies (Electron and electron-builder). This downloads Electron itself and takes a few minutes.

   ```
   npm install
   ```

   If `node_modules\electron\dist\electron.exe` does not exist afterwards, run `npx install-electron` to download Electron.

4. Start the app.

   ```
   npm start
   ```

To run the automated tests, run `npm test`. The tests do not need Electron; they cover the storage layer and the history, Markdown and search logic.

### Building the installer

```
npm run dist
```

This creates an installer (`EverPad Setup 0.18.0.exe`) and a portable executable that needs no installation in the `dist` folder. The installer can be shown in English or Japanese, and offers a check box (off by default) to add EverPad to the Explorer "Send to" menu. The executables are not code-signed, so Windows may show "Windows protected your PC" the first time you run one. Choose "More info" and then "Run anyway".

**Uninstalling**: the uninstaller never deletes your data folder (your notes stay). It offers a check box (off by default) to also delete EverPad's settings (`%APPDATA%\EverPad`: the data folder location, language, window position, recently viewed notes and so on). Settings are kept per Windows user, so only the settings of the user running the uninstaller are deleted, also when EverPad was installed for all users; other users' settings are not touched. Updates and silent uninstalls (`/S`) never delete settings.

### Portable version

The portable executable (`EverPad 0.18.0.exe`) keeps everything in an `EverPad Data` folder next to itself, so you can carry it on a USB drive:

```
EverPad 0.18.0.exe
EverPad Data\
  settings\   settings, recently viewed notes, caches
  notes\      the data folder (default)
```

- The data folder inside `EverPad Data` is remembered relative to the executable, so it keeps working when the drive letter changes.
- The portable and installed versions do not share settings, and can run at the same time. Their "Send to" entries have different names (`EverPad (Portable)` and `EverPad`), and they appear as separate taskbar buttons.
- If the folder of the executable cannot be written to (for example, inside Program Files), settings are saved in `%APPDATA%\EverPad Portable` and notes in `Documents\EverPad Portable`; EverPad tells you once.
- Versions before 0.17.0 stored the portable version's settings and notes in `%APPDATA%\EverPad` and `Documents\EverPad`. Those notes are not moved: choose File → Change Data Folder… and select `Documents\EverPad`, or copy the note files into `EverPad Data\notes`.
- Everything EverPad saves stays in `EverPad Data` (plus the "Send to" shortcut if you add it). Windows itself still records some traces, and the portable executable unpacks itself into a temporary folder (`%TEMP%`) each time it starts.

### macOS and Linux (untested)

EverPad is developed and tested on Windows. Because it is built with Electron, it can also be built for macOS and Linux, and it includes the changes needed for them (described below). However, these builds have **not been tested on a real Mac or Linux computer**, so treat them as experimental.

**Building**: build on the OS you want to use it on (macOS and Linux versions cannot be built on Windows). Install Node.js, then in the folder that contains `package.json` run `npm install`, and then `npm start` to try it, or `npm run dist` to create the following in the `dist` folder:

- macOS: `.dmg` disk images for Apple silicon (arm64) and Intel Macs (x64)
- Linux: `EverPad-0.18.0.AppImage` (x64)

**Building with GitHub Actions**: the repository can build both without a Mac or Linux computer. On GitHub, open the Actions tab, choose "Build (macOS / Linux)" and press "Run workflow" (it also runs when a tag starting with `v`, such as `v0.18.0`, is pushed). When it finishes, download `everpad-macos` (the `.dmg` files) and `everpad-linux` (the AppImage) from Artifacts at the bottom of the run's page. You need to be signed in to GitHub, and the files are kept for 30 days. They are not published as a release. Each build is started once to check that it does not crash, and a screenshot is saved in `smoke-macos` / `smoke-linux`; this is not a substitute for testing on a real computer. Files downloaded this way come in a ZIP file: on macOS, see the note below about opening a downloaded copy, and on Linux, allow the AppImage to run again after extracting it.

**macOS**

- The menus follow the macOS layout: an EverPad menu (About EverPad, Services, Hide EverPad, Quit EverPad and so on) on the left, and a Window menu.
- Shortcuts use ⌘ instead of Ctrl (⌘N, ⌘F and so on). These differ, because macOS uses the Windows keys for something else: Back to Previous Note ⌘[, Properties ⌘I, Find and replace ⌥⌘F, Quote ⌘' (⌘H hides the app and ⇧⌘Q logs out). Redo is ⇧⌘Z, and a link to another note opens with ⌘-click in the editor.
- Closing the window does not quit EverPad: it stays in the Dock, and clicking the Dock icon opens the window again. Quit with ⌘Q. Unsaved edits are saved when the window closes. While EverPad is running, its data folder stays locked (see "Where notes are stored").
- `.everpad` files can be opened by double-clicking them in Finder, with Open With, or by dragging them onto the Dock icon. Import text files by dragging them into the window, or with File → Import….
- Settings are saved in `~/Library/Application Support/EverPad`, and notes in `~/Documents/EverPad`. The first time, macOS asks whether EverPad may access the Documents folder.
- The app has an ad-hoc signature (a simple signature that does not use an Apple certificate), but is not signed with an Apple Developer ID or notarized by Apple. A copy you built yourself normally opens. A downloaded copy is blocked the first time with a message such as "Apple could not verify 'EverPad' is free of malware". Only if you trust where the copy came from: choose Done, open System Settings → Privacy & Security, and click Open Anyway next to the message about EverPad (on macOS 14 and earlier, you can instead Control-click EverPad in Finder and choose Open). If that does not work, run `xattr -cr /Applications/EverPad.app` in Terminal.
- To uninstall, move EverPad to the Trash. Settings in `~/Library/Application Support/EverPad` and your notes are not deleted.
- The "Send to" menu entry and the installer options are Windows only.

**Linux (AppImage)**

- The AppImage works like the Windows portable version: it keeps settings and notes in an `EverPad Data` folder next to the AppImage file. If that folder cannot be written to, settings are saved in `~/.config/EverPad Portable` and notes in `~/Documents/EverPad Portable`.
- After downloading, allow the file to run (`chmod +x EverPad-0.18.0.AppImage`, or the file's properties).
- Some distributions need FUSE 2 to run AppImages (the `libfuse2` package, `libfuse2t64` on Ubuntu 24.04).
- On Ubuntu 24.04 and later, Electron AppImages may fail to start because of a security restriction (AppArmor and unprivileged user namespaces). Starting it with `--no-sandbox` works around this, but turns off Chromium's sandbox, a security protection; if you can, allow it with an AppArmor profile instead.
- Because nothing is installed, there is no entry in the app list, and double-clicking an `.everpad` file does not open EverPad. Use File → Import… or drag the file into the window.
- While running, the AppImage is mounted read-only under `/tmp`.
- Menus and windows behave as on Windows (closing the window quits EverPad).

### Usage

| Action | Key |
|---|---|
| New note | `Ctrl+N` |
| Search all notes | `Ctrl+F` |
| Back to the previously viewed note | `Alt+←` |
| Import (EverPad archives and text files) | `Ctrl+O` |
| Export as a text file | `Ctrl+Shift+E` |
| Print | `Ctrl+P` |
| Export as PDF | `Ctrl+Shift+P` |
| Properties of the current note | `Alt+Enter` |
| Edit / Preview | `Ctrl+1` / `Ctrl+2` |
| Show / hide history | `Ctrl+3` (or the History button at the top) |
| Attach an image or file | `Ctrl+Shift+U` (or paste with `Ctrl+V`, drag and drop, or the Attach button at the top right) |
| Find and replace (a bar appears above the editor) | `Ctrl+H` |
| Insert a link to another note | `Ctrl+K` |
| Quote / bulleted list / numbered list / code block for the selected lines | `Ctrl+Shift+Q` / `Ctrl+Shift+8` / `Ctrl+Shift+7` / `Ctrl+Shift+K` |
| Find next / previous | `Enter` / `Shift+Enter` (also `F3` / `Shift+F3` while the bar is open) |
| Show / hide the left pane (note list and search) | `Ctrl+B` (or the menu button at the top left) |
| Show / hide line numbers | `Ctrl+L` (or the Line numbers button at the bottom right) |
| Previous / next version in the history | `←` / `→` |
| Play / pause the history | `Space` |

On macOS, Ctrl becomes ⌘, and some keys are different (see "macOS and Linux (untested)").

**Views and history**

- There are two views, Edit and Preview, and each has a history mode. Pressing History shows the time slider while keeping the current view: in Edit, the characters changed in each version are highlighted; in Preview, each version is shown formatted. Switching between Edit and Preview during the history keeps the same version. Press History again to leave the history.
- Playback speed can be set to five levels, from very slow to very fast.
- Restore this version adds the content of that version as a new edit. The existing history is never deleted.
- The note text widens to fit the window. Line numbers count a wrapped line as one line and are also shown in the history. These settings are remembered.

**Search and replace**

- Search can target Latest version or All history. The history search finds every place where the text was ever written, including text that has since been deleted.
- Find and replace supports case sensitivity, whole words and regular expressions. With regular expressions, the replacement can use `$1` (a captured group), `$&` (the whole match), `\n` (newline) and `\t` (tab). Replace all is recorded in the history as a single edit and can be undone with `Ctrl+Z`. `Ctrl+F` remains the search across all notes.

**Recently viewed notes and links between notes**

- File → Recently Viewed Notes lists the ten notes you opened most recently (excluding the current one), newest first. Deleted notes stay in the list marked "(deleted)"; choosing one shows a message. A note restored from the Recycle Bin opens again. The list is kept per data folder; Clear List empties it. (Recently updated notes are already at the top of the note list on the left.)
- File → Back to Previous Note (`Alt+←`) opens the note you viewed before the current one. Pressing it again switches back, so you can go back and forth between two notes, for example after following a link.
- Write `[text to show](note:note ID)` to link to another note. You do not need to type the ID: choose Edit → Insert Link to Note… (`Ctrl+K`) and pick a note from the list (type to filter by title), or click Copy Link to This Note in the target note's Properties and paste it.
- Click a link in the preview or the history's Markdown view, or `Ctrl`+click it in the editor, to open that note. Hover over it to see the target's current title. Links point to the note, not to a position in it, and are not broken when the target's title or text changes. If the target is deleted, the link is shown struck through in gray, and clicking it shows a message.
- To find notes that link to a note, search all notes for `note:` followed by its ID (shown in Properties). In printouts, PDFs and exported text, links stay as written.

**Math**

- Write LaTeX between `$` for math inside text (`$E = mc^2$`), or between lines containing only `$$` for a formula on its own line. `\( … \)`, `\[ … \]` and ```` ```math ```` code blocks also work. Chemical formulas can be written with `\ce{…}` (mhchem), for example `$\ce{H2O}$`.
- Formulas are shown in the preview, the history's Markdown view, printouts and PDFs. The editor and search keep the LaTeX as text.
- To keep prices such as "$5 and $10" from becoming math, the same rule as Pandoc and GitHub is used: there must be no space just inside the `$`, and the closing `$` must not be followed by a digit. Write `\$` for a literal dollar sign.
- In a table, `|` inside a formula is taken as a cell separator; write `\vert` instead.
- A formula with an error is shown as its LaTeX in red; hover over it to see the error. Right-click a formula and choose Copy LaTeX to copy its source.
- Math is drawn with [KaTeX](https://katex.org/), which is bundled with the app (no internet connection is used). KaTeX supports most common math commands, but not everything in LaTeX (for example, drawings such as TikZ, or `\label` / `\ref`). Commands that refer to external resources, such as `\href` and `\includegraphics`, are disabled.

**Formatting lines**

- Choose Edit → Format → Quote, Bulleted List, Numbered List or Code Block (also on the editor's right-click menu) to format every line the selection touches, or the cursor's line when nothing is selected. A selection that ends right at the start of a line does not include that line.
- Quotes add `> ` to each line (`>` on empty lines, so the quote is not broken). Bulleted and numbered lists add `- ` or `1. `, `2. ` … after the indentation and skip empty lines; applying one to the other switches between them. Code blocks add a ```` ``` ```` line before and after the lines.
- If all the lines already have that format, it is removed instead (for a code block: when the lines are surrounded by ```` ``` ```` lines). Tables and headings are processed the same way, without exceptions.
- The change is recorded in the history as a single edit and can be undone with `Ctrl+Z`. Available in the Edit view.

**Images and attachments**

- In the editor, paste a copied image (such as a screenshot), drag and drop a file onto the window, or choose a file with the Attach button. `![name](attach:…)` (image) or `[name](attach:…)` (file) is inserted at the cursor, and is shown as an image or a file link in the preview and in the history's Markdown view. Pasting inside a table row puts the attachment in that cell (several attachments line up side by side). Clicking an image or link opens it; executables and similar files are not opened, but shown in their folder instead.
- The files are kept in the note's `.files` folder. **The app never deletes an attachment, even if you remove it from the text, so that older versions in the history can still show it.** Identical files are stored only once. The size limit is 50 MB per file.
- You may freely edit the "name" part before `attach:` (avoid `|`, `[` and `]`). Copying the attachment syntax into another note does not work, because the file does not exist in that note; paste the file again instead.
- A list of the attachments used in the note (thumbnails) is shown below the text.
- Right-click an image (in the preview, the history's Markdown view or the attachment list) for Copy Image, Open Image, Show Image in Folder and Save Image As…. Right-click a file link for Open File and Show File in Folder. Left-clicking still opens it.

**Importing and exporting**

- File → Import… (`Ctrl+O`) imports EverPad archives (`.everpad`) and text files. EverPad tells them apart by their contents, so you can choose several files of both kinds at once.
- File → Export has three formats: Text File… (`Ctrl+Shift+E`), PDF… (`Ctrl+Shift+P`, see "Printing and PDF") and EverPad Archive…. Printing (File → Print…) is a separate command because it does not create a file.
- The file dialogs open in the folder you used last time, remembered separately for importing and exporting (all export formats and Save Image As… share one folder) and kept after EverPad is closed. The first time, or if that folder no longer exists, importing opens the data folder and exporting opens Documents.

**EverPad archives**

- File → Export → EverPad Archive… saves the current note as one `.everpad` file containing its text, its whole history and its attachments (the whole note, even while the history is shown). It is a ZIP file: rename it to `.zip` to look inside (`manifest.json`, `note.jsonl`, `note.md` and `files/`).
- Importing an archive restores the note with its history and attachments. If a note with the same ID already exists, you choose: **Overwrite** replaces the existing note's text, history and attachments (this cannot be undone in EverPad; the original files are moved to the Recycle Bin), **Import with a New ID** imports it as a separate note, or **Cancel**.
- An imported note is shown at the top of the note list: EverPad records when it was imported (in the history file's header line, which older versions ignore) and sorts the list by the later of the last edit and the import. Properties shows the import time.
- The installer associates `.everpad` files with EverPad, so double-clicking an archive imports it. Sending archives with "Send to" or dropping them onto the EverPad icon also works.
- Archives are checked before importing (format, note ID, history, attachment names and size); damaged or invalid archives are not imported.

**Importing text files**

- Each text file becomes a new note; its first line becomes the title.
- In Explorer, select files and choose Send to → EverPad to import them. EverPad starts if it is not running. To add EverPad to the "Send to" menu, check the box in the installer, or choose File → Add to the "Send to" Menu at any time (choose it again to remove it). Dropping files onto the EverPad icon also imports them. Dropping files onto the EverPad window still attaches them.
- The encoding is detected automatically: UTF-8 (with or without BOM), UTF-16, Shift_JIS, EUC-JP and ISO-2022-JP. Line breaks are converted to LF. Files larger than 10 MB, files that are not text, and files with data that cannot be read as text are not imported; the reason is shown, including where the unreadable data is (for example, "Read as Shift_JIS, line 12, character 5 … (0x82 0xFF)").
- An imported note belongs to EverPad and has no link to the original file; EverPad does not record where it was imported from.
- File → Export → Text File… (`Ctrl+Shift+E`) saves the current note as a `.txt` or `.md` file (UTF-8 without BOM, CRLF line breaks). While the history is shown, the version being viewed is exported. Attachments are not included.

**Printing and PDF**

- Choose File → Print… (`Ctrl+P`) to print the current note, or File → Export → PDF… (`Ctrl+Shift+P`) to save it as a PDF.
- The note is printed with the same formatting as the preview (headings, tables, check boxes and attached images), whichever view you are in. While the history is shown, the version you are viewing is printed.
- Each page shows the note title and the time of the last edit at the top, and the time it was printed (or the PDF was created) and the page number at the bottom. When a past version is printed, its version number is shown too.
- Even in dark mode, notes are printed as dark text on white paper. PDFs use A4 paper (Letter in the United States and Canada).

**Other**

- Menu items that cannot be used in the current view are grayed out (and their shortcut keys do nothing): Find and Replace…, Attach Image or File…, Format and Insert Link to Note… work only in the Edit view; Toggle Line Numbers (and the Line numbers button at the bottom right) works only where line numbers are shown (the Edit view and the history started from it); Back to Previous Note works only when there is a note to go back to.
- Right-click a note in the note list on the left (or in the search results) for actions on that note, regardless of the note that is open: Open, Copy Link to This Note, Export (text file, PDF or EverPad archive; the latest version), Properties… and Delete…. The menu starts with the note's title, and the row is outlined while the menu is open. Deleting a note that is not open leaves the open note as it is.
- Hover over a link in the preview to see where it goes at the bottom left, as in a web browser: the address, the title of the linked note, the heading, or the attachment name. Links EverPad cannot open, such as relative paths to files, are marked "(cannot be opened in EverPad)".
- Choose File → Properties… (`Alt+Enter`) to see the current note's title, note ID, creation and last edit times, number of versions, characters (without line endings), words, lines, and the files that store it: the history file (`.jsonl`), the text file (`.md`) and the attachment folder (`.files`), with their sizes. Each file has buttons to show it in Explorer and to copy its path. Characters, words and lines are counted as in Notepad++'s Summary: a word is a run of characters other than spaces, line breaks and the ASCII symbols ``\ . , ; : ! ? ( ) + - * / = [ ] { } & ~ " ' ` | @ $ % < > ^`` (so Japanese punctuation does not separate words), and an empty note has one line.
- Right-click in the editor (or in the find and replace fields) for undo, redo, cut, copy, paste, delete and select all. In the preview and the history, select text and right-click to copy.
- The window position and size (including whether it was maximized) are restored at the next start. If the previous position would be off screen, for example because a display was disconnected, the position is left to Windows.
- To change the interface language, choose View → Language (言語) → English or 日本語. The setting is remembered, and the current view (Edit, Preview or history, the search, the find and replace bar, the cursor and scroll position) is kept when switching.
- The status bar shows up to three groups, separated by lines: **Cursor** (the line and column of the input position, in the Edit view), **Selected** (the number of selected characters, and lines when several lines are selected; shown only while text is selected) and **Total** (characters, lines and versions of the whole note; while the history is shown, the characters and lines of the version being viewed). Line breaks are not counted as characters, and lines are counted by line breaks, as with line numbers (an empty note has one line). Hover over a group for a short explanation.
- Choose Help → Markdown Guide for the Markdown you can use, with each example shown next to its result. See also "Markdown syntax" below.
- To check the version you are running, choose Help → About EverPad from the menu. It also shows the Electron version, the data folder and the address where EverPad is published (https://github.com/nihongi/everpad/); Open on GitHub opens it in your browser.

### Markdown syntax

| Element | You type |
|---|---|
| Headings | `# Heading 1`, `## Heading 2` … `###### Heading 6` |
| Emphasis | `**bold**`, `*italic*`, `~~strikethrough~~`, `` `code` `` |
| Lists | `- item` (or `*`, `+`; indent by two spaces to nest), `1. item` |
| Check boxes | `- [ ] to do`, `- [x] done` |
| Links | `[text](https://example.com)` (opened in the browser), `[text](#heading)` (jumps to a heading in the same note). Other links, such as relative paths, are shown as links but cannot be opened |
| Block quotes | `> quoted text` |
| Code blocks | lines surrounded by ```` ``` ```` (or `~~~`); to put ```` ``` ```` lines inside, surround with ````` ```` ````` |
| Horizontal rules | `---` |
| Tables | `\| a \| b \|` followed by `\|:---\|---:\|` (`:---` left, `:---:` center, `---:` right) |
| Math | `$E = mc^2$` (in text), `$$` lines around a formula (on its own line), `\ce{H2O}` (chemistry) |
| Links to notes | `[text](note:note ID)`, inserted with `Ctrl+K` |
| Attachments | `![name](attach:…)` (image), `[name](attach:…)` (file), inserted automatically |

Unlike some other Markdown, a line break inside a paragraph is shown as a line break, only attached images are displayed, and HTML tags are shown as plain text.

### Where notes are stored

The default data folder is `Documents\EverPad`. You can change it with File → Change Data Folder…, and open it in Explorer with File → Open Data Folder.

Each note consists of the following files and folder.

| File | Contents |
|---|---|
| `<date-time>-<id>.jsonl` | The edit history itself. The first line is a header; each following line is one edit, `[position, deleted text, inserted text, time (ms)]`. The file only ever grows by appending, so a crash while writing cannot damage the earlier history. |
| `<date-time>-<id>.md` | The latest text, for reading with other apps. Search across all notes reads the latest text of unopened notes from here (if it is older than the history, the text is rebuilt from the history). |
| `<date-time>-<id>.files\` | Pasted images and attached files (see "Images and attachments"). Created only when the note has attachments. |

The data folder also contains `.everpad-index.json`, an index for the note list (title, number of versions and last update time) that makes startup faster. It is rebuilt automatically if it is deleted or damaged.

- To back up, just copy the data folder.
- If a `.jsonl` file is damaged partway through, the readable part is used and the original file is kept under the name `.corrupt-…`.
- Deleting a note moves its files and its attachment folder to the Recycle Bin. On drives without a Recycle Bin (USB drives, network folders), they are moved to a `.trash` folder inside the data folder instead, because Windows would otherwise delete them permanently. Overwriting a note by importing an archive works the same way. Empty `.trash` yourself when you no longer need it. On macOS and Linux, files go to the system Trash, and to `.trash` only if that fails.
- The same data folder cannot be opened by two EverPads at the same time on one computer: while open, EverPad keeps a `.everpad-lock` file in it, and another EverPad (for example the portable version) that tries to open the folder asks you to choose another folder or quit. The lock is ignored if it is left over from a crash. If you share the folder between computers with OneDrive or similar, close EverPad on one computer before opening it on another.

### Performance with many notes

- At startup, only the index for the note list is read. A note's history file is read again only when its size or modification time no longer matches the index.
- The full content, including history, is loaded only for notes you open. The six most recently used notes are kept in memory; others are released (notes being edited or waiting to be saved are never released).
- The note list is not rebuilt on every keystroke, but updated once typing has settled.
- Search across all notes runs in batches of 100 notes (20 when searching the history), and changing the search text cancels the previous search. Unopened notes are discarded after being read. Searching the latest version reads only the latest text, not the history.

### Importing from Etherpad

A MySQL dump of Etherpad can be converted to EverPad's format.

```
node tools/import-etherpad.js <dump file> <output folder>
```

- Each pad becomes one note (`.jsonl` and `.md`), and its Etherpad revisions are replayed one by one to build the history. A pad whose converted text does not match Etherpad's latest text is skipped with a message.
- Copy the contents of the output folder into EverPad's data folder (`Documents\EverPad`) to read them. Close EverPad before copying.
- Headings become `#`, bullets and indents `-`, numbered lists `1.`, bold, italic and strikethrough `**` `*` `~~`, and tables (ep_tables2) Markdown tables. Underline, colors, authors, chat and saved revisions (bookmarks) are not imported.
- The sample text that Etherpad puts in new pads ("Welcome to Etherpad!") is not imported.
- The pad name is added as plain text on the first line of each note, so it becomes the note's title (EverPad uses the first line as the title). Use `--no-title-line` to not add it, or `--as-is=<pad name>` to skip it for a specific pad. A table of pad names and note IDs is written to `etherpad-import-map.csv`.

### Project structure

```
build/           Icons (icon.ico / icon.png) and a script that rebuilds them from the source image (make-icon.py)
contextmenu.js   Contents of the right-click menu
main.js          Electron main process (window, menus, data folder, Recycle Bin)
preload.js       The bridge exposed to the UI (saving, loading and menu actions only)
store.js         File storage layer (testable without Electron)
windowstate.js   Remembering and restoring the window position (testable without Electron)
portable.js      Where the portable version (and the Linux AppImage) keeps its settings and notes (testable without Electron)
macmenu.js       The macOS menu layout and shortcut keys (testable without Electron)
datalock.js      The lock that keeps two EverPads from opening the same data folder (testable without Electron)
textcodec.js     Detecting the encoding of imported text files (testable without Electron)
archive.js       EverPad archives: building, checking and reading (testable without Electron)
ziplite.js       Minimal ZIP reading and writing for archives, using Node.js zlib (testable without Electron)
sendto.js        The "Send to" shortcut and reading files passed at startup (testable without Electron)
renderer/        The UI (index.html / styles.css / app.js), the history, Markdown and search logic (core.js), the English and Japanese texts (i18n.js),
                 and the Markdown Guide window (help.html / help.css / help.js / help-content.js)
tools/           The Etherpad import tool (import-etherpad.js), and the script that copies KaTeX into renderer/vendor/katex (vendor-katex.js)
renderer/vendor/katex/  KaTeX for math (copied from node_modules automatically before npm start and npm run dist; not stored in Git)
build/installer.nsh  The installer's "Send to" check box and the uninstaller's "delete settings" check box
.github/workflows/build.yml  Building the macOS and Linux versions with GitHub Actions
test/            Automated tests
```

### Security

- Images are loaded only through the dedicated `everpad-file://` scheme, which cannot read files outside the data folder.
- The UI cannot use Node.js directly (`contextIsolation` and `sandbox` are enabled) and cannot navigate away from the app. Only external links are opened, in the default browser.
- The installed app does not accept debugging connections: `--inspect`, `NODE_OPTIONS` and `ELECTRON_RUN_AS_NODE` are disabled in the executable itself (Electron fuses), and `--remote-debugging-port` and similar switches are ignored. Development runs with `npm start` are not affected.
- The installed app checks at startup that its code (`app.asar`) has not been modified, and refuses to start if it has been changed or replaced (Electron fuses: OnlyLoadAppFromAsar and EnableEmbeddedAsarIntegrityValidation).

### Testing

- The storage layer, the window position logic, the encoding detection for imports, the "Send to" helpers, the history, Markdown and search logic, and the English and Japanese texts (every key exists in both languages) are covered by automated tests (`npm test`).
- The UI has been tested in Chromium with a stand-in for the storage bridge: typing, rewinding, search, restore, delete, and recovery after reload.
- Running the app with Electron (`npm start`) has been tested on Windows 11 with Electron 44.7.0, including editing, rewinding and search.
- Building the installer (`npm run dist`) has been tested with electron-builder 26.15.3, together with installing and using the installed app.

### License

MIT License. See [LICENSE](LICENSE) for the full text.

Copyright (c) 2026 Nobuyoshi NIHONGI

EverPad includes [KaTeX](https://github.com/KaTeX/KaTeX) (MIT License, Copyright (c) 2013-2020 Khan Academy and other contributors) for showing math. Its license is copied to `renderer/vendor/katex/LICENSE`.

---

## 日本語

EverPad は Windows 用のメモ帳です。テキストまたは Markdown(表を含む)で書けて、1回ごとの編集がすべて履歴に残り、タイムスライダーで巻き戻して書いた過程を見られます。Electron で作っています。

画面は日本語と英語に対応しています。最初は Windows の表示言語に合わせ(日本語以外のときは英語)、メニューの「表示」→「言語 (Language)」でいつでも切り替えられます。

このプログラムは Claude Code を活用して作成しました。

### 特長

- **すべての編集を履歴に残す**: タイムスライダーを動かすか履歴を再生すると、どの時点の版でも見られます。その版にはボタン1つで戻せます。
- **Markdown のプレビュー**: 見出し、箇条書き、チェックボックス、コード、リンク、引用、表に対応しています。
- **数式**: LaTeX の数式(と化学式)を、プレビュー・履歴・印刷で整形した数式として表示します。
- **全メモの検索**: 各メモの最新の版だけでなく、消したあとの文字も含めて履歴全体から探せます。
- **検索と置換**: 大文字/小文字の区別、単語単位、正規表現を選べます。
- **画像・ファイルの添付**: スクリーンショットを貼り付けたり、ファイルをドラッグ&ドロップしたりできます。
- **印刷と PDF**: メモを、プレビューと同じ整形した見た目で印刷したり、PDF として保存したりできます。
- **日本語と英語**: 画面の言語をメニューから切り替えられます。
- **普通のファイルで保存**: メモは選んだフォルダに普通のファイルとして保存されるので、バックアップはフォルダをコピーするだけです。

### 動かすために必要なもの

- Windows 10 / 11(macOS 版と Linux 版もソースから作れますが、動作は確かめていません。下の「macOS と Linux(未確認)」を見てください)
- [Node.js](https://nodejs.org/ja)(LTS 版。v20 以降)

### 起動する

1. このソース一式を、好きな場所に置きます。
2. `package.json` のあるフォルダで PowerShell またはコマンドプロンプトを開きます。
3. 初回だけ、次を実行して Electron と electron-builder を導入します。Electron 本体をダウンロードするので数分かかります。

   ```
   npm install
   ```

   このあと `node_modules\electron\dist\electron.exe` ができていないときは、`npx install-electron` を実行して Electron 本体を取得します。

4. 起動します。

   ```
   npm start
   ```

自動テストは `npm test` で実行します。Electron なしで動き、保存処理と、履歴・Markdown・検索のロジックを確認します。

### インストーラーを作る

```
npm run dist
```

`dist` フォルダに、インストーラー(`EverPad Setup 0.18.0.exe`)と、インストール不要の実行ファイル(portable 版)ができます。インストーラーは日本語と英語を選べ、エクスプローラーの「送る」メニューに EverPad を追加するかのチェックボックス(既定はオフ)があります。署名はしていないため、初めて実行するときに Windows が「Windows によって PC が保護されました」と表示することがあります。その場合は「詳細情報」→「実行」を選びます。

**アンインストール**: アンインストーラーは、メモの保存先フォルダを削除しません(メモは残ります)。「EverPad の設定も削除する」のチェックボックス(既定はオフ)を付けると、EverPad の設定(`%APPDATA%\EverPad`。保存先の場所、言語、ウィンドウの位置、最近見たメモなど)も削除します。設定は Windows のユーザーごとにあるため、削除するのはアンインストールを実行したユーザーの設定だけです。すべてのユーザー向けにインストールした場合も同じで、他のユーザーの設定には触れません。更新のときや、画面を出さないアンインストール(`/S`)では、設定を削除しません。

### portable 版

portable 版(`EverPad 0.18.0.exe`)は、実行ファイルと同じフォルダの `EverPad Data` にすべてを保存します。USB メモリなどに入れて持ち運べます。

```
EverPad 0.18.0.exe
EverPad Data\
  settings\   設定、最近見たメモ、キャッシュ
  notes\      メモの保存先(既定)
```

- `EverPad Data` の中の保存先は実行ファイルからの相対で覚えるので、ドライブ文字が変わっても動きます。
- インストール版とは設定を共有せず、同時に起動できます。「送る」メニューの名前(`EverPad (Portable)` と `EverPad`)と、タスクバーのボタンも別になります。
- 実行ファイルのフォルダに書き込めない場合(Program Files の中など)は、設定を `%APPDATA%\EverPad Portable` に、メモを `ドキュメント\EverPad Portable` に保存します。そのことは一度だけ知らせます。
- 0.17.0 より前の portable 版は、設定とメモを `%APPDATA%\EverPad` と `ドキュメント\EverPad` に保存していました。そのメモは移しません。「ファイル」→「保存先フォルダを変更…」で `ドキュメント\EverPad` を選ぶか、メモのファイルを `EverPad Data\notes` にコピーしてください。
- EverPad が保存するものは `EverPad Data` の中だけです(「送る」に登録したときのショートカットを除く)。ただし、Windows 自体が記録するものは残ります。また、portable 版は起動のたびに一時フォルダ(`%TEMP%`)に自分自身を展開して動きます。

### macOS と Linux(未確認)

EverPad は Windows で作り、Windows で動作を確かめています。Electron で作っているので macOS 版と Linux 版も作れ、そのための対応(下に書いたもの)も入れてあります。ただし、**Mac と Linux の実機では動作を確かめていません**。試験的なものとして扱ってください。

**作り方**: 使う OS の上で作ります(Windows の上では macOS 版と Linux 版を作れません)。Node.js を入れ、`package.json` のあるフォルダで `npm install` を実行してから、`npm start` で試すか、`npm run dist` で `dist` フォルダに次のものを作ります。

- macOS: Apple シリコン(arm64)用と Intel の Mac(x64)用の `.dmg`(ディスクイメージ)
- Linux: `EverPad-0.18.0.AppImage`(x64)

**GitHub Actions で作る**: Mac や Linux のパソコンが無くても、リポジトリで両方を作れます。GitHub の Actions タブで「Build (macOS / Linux)」を選び、「Run workflow」を押します(`v0.18.0` のような v で始まるタグを push したときも動きます)。終わったら、実行結果のページの下の Artifacts から `everpad-macos`(`.dmg`)と `everpad-linux`(AppImage)をダウンロードします。GitHub へのサインインが必要で、ファイルは30日間残ります。リリースとしては公開しません。作ったものは一度起動して落ちないことを確かめ、スクリーンショットを `smoke-macos` / `smoke-linux` に残します。ただし、実機での確認の代わりにはなりません。この方法でダウンロードしたファイルは ZIP に入っています。macOS では下の、ダウンロードしたものを開くときの注意を、Linux では展開したあとに AppImage へ実行の許可を付け直すことを見てください。

**macOS**

- メニューは Mac の形です。一番左に「EverPad」メニュー(EverPad について、サービス、EverPad を隠す、EverPad を終了など)があり、「ウインドウ」メニューもあります。
- ショートカットキーは Ctrl の代わりに ⌘ を使います(⌘N、⌘F など)。Windows のキーを Mac が別の操作に使っているため、次のものは違います: 前に見たメモに戻る ⌘[、プロパティ ⌘I、検索と置換 ⌥⌘F、引用 ⌘'(⌘H は「隠す」、⇧⌘Q は「ログアウト」)。やり直しは ⇧⌘Z、編集画面で他のメモへのリンクを開くのは ⌘+クリックです。
- ウィンドウを閉じても EverPad は終わらず、Dock に残ります。Dock のアイコンを押すと、ウィンドウがまた開きます。終えるときは ⌘Q です。書きかけの編集は、ウィンドウを閉じたときに保存します。EverPad が動いている間は、保存先の印が残ります(「メモの保存先と形式」を見てください)。
- `.everpad` ファイルは、Finder でダブルクリック、「このアプリケーションで開く」、Dock のアイコンへのドラッグで開けます。テキストファイルは、ウィンドウへのドラッグか、「ファイル」→「インポート…」で取り込みます。
- 設定は `~/Library/Application Support/EverPad` に、メモは `~/書類/EverPad`(`~/Documents/EverPad`)に保存します。初めて起動したとき、書類フォルダへのアクセスを許可するかを Mac が尋ねます。
- ad-hoc 署名(Apple の証明書を使わない簡易の署名)は付けてありますが、Apple の Developer ID による署名と公証はしていません。自分で作ったものは普通は開けます。ダウンロードしたものは、初めて開くときに「"EverPad"にマルウェアが含まれていないことを Apple は検証できませんでした」のような表示で止められます。入手先が信頼できる場合に限り、「完了」を押してから「システム設定」→「プライバシーとセキュリティ」を開き、EverPad についての表示の横の「このまま開く」を押してください(macOS 14 以前では、Finder で EverPad を control キーを押しながらクリックして「開く」を選ぶ方法でも開けます)。それでも開けない場合は、ターミナルで `xattr -cr /Applications/EverPad.app` を実行します。
- アンインストールは、EverPad をゴミ箱に入れるだけです。`~/Library/Application Support/EverPad` の設定とメモは削除されません。
- 「送る」メニューへの登録と、インストーラーの追加の設定は Windows だけです。

**Linux(AppImage)**

- AppImage は Windows の portable 版と同じように動きます。設定とメモを、AppImage ファイルと同じフォルダの `EverPad Data` に保存します。そこに書き込めない場合は、設定を `~/.config/EverPad Portable` に、メモを `~/Documents/EverPad Portable` に保存します。
- ダウンロードしたら、ファイルに実行の許可を付けます(`chmod +x EverPad-0.18.0.AppImage`、またはファイルのプロパティで)。
- ディストリビューションによっては、AppImage を動かすのに FUSE 2 が必要です(`libfuse2` パッケージ。Ubuntu 24.04 では `libfuse2t64`)。
- Ubuntu 24.04 以降では、セキュリティの制限(AppArmor と非特権ユーザー名前空間)のため、Electron の AppImage が起動しないことがあります。`--no-sandbox` を付けて起動すると回避できますが、Chromium のサンドボックス(安全のための仕組み)が無効になります。できれば AppArmor のプロファイルで許可してください。
- インストールしないので、アプリの一覧には出ず、`.everpad` ファイルをダブルクリックしても EverPad は開きません。「ファイル」→「インポート…」か、ウィンドウへのドラッグを使います。
- 動いている間は、`/tmp` の下に読み込み専用で展開されます。
- メニューとウィンドウは Windows と同じ動きです(ウィンドウを閉じると EverPad は終わります)。

### 使い方

| 操作 | キー |
|---|---|
| 新しいメモ | `Ctrl+N` |
| 全メモから検索 | `Ctrl+F` |
| 前に見たメモに戻る | `Alt+←` |
| インポート(EverPad アーカイブとテキストファイル) | `Ctrl+O` |
| テキストファイルとしてエクスポート | `Ctrl+Shift+E` |
| 印刷 | `Ctrl+P` |
| PDF としてエクスポート | `Ctrl+Shift+P` |
| 今のメモのプロパティ | `Alt+Enter` |
| 編集 / プレビュー | `Ctrl+1` / `Ctrl+2` |
| 履歴表示の切り替え | `Ctrl+3`(画面上部の「履歴」ボタンでも) |
| 画像・ファイルを添付 | `Ctrl+Shift+U`(`Ctrl+V` での貼り付け、ドラッグ&ドロップ、右上の「添付」ボタンでも) |
| 検索と置換(編集画面の上にバーが出ます) | `Ctrl+H` |
| 他のメモへのリンクを挿入 | `Ctrl+K` |
| 選んだ行を引用 / 箇条書き / 番号付きの箇条書き / コードブロックにする | `Ctrl+Shift+Q` / `Ctrl+Shift+8` / `Ctrl+Shift+7` / `Ctrl+Shift+K` |
| 次を検索 / 前を検索 | `Enter` / `Shift+Enter`(バーを開いている間は `F3` / `Shift+F3` でも) |
| 左側(メモ一覧と検索)の表示 / 非表示 | `Ctrl+B`(左上の三本線ボタンでも) |
| 行番号の表示 / 非表示 | `Ctrl+L`(右下の「行番号」ボタンでも) |
| 履歴で1つ前 / 1つ先の版へ | `←` / `→` |
| 履歴の再生 / 停止 | `Space` |

macOS では Ctrl が ⌘ になり、いくつかのキーが違います(「macOS と Linux(未確認)」を見てください)。

**表示と履歴**

- 表示は「編集」と「プレビュー」の2つで、どちらにも履歴の表示があります。「履歴」ボタンを押すと、今の表示のままタイムスライダーが出ます。編集の履歴では、その版で変わった文字が色で示され、プレビューの履歴では、その版が整形して表示されます。履歴の表示中に「編集」「プレビュー」を押すと、同じ版のまま切り替わります。もう一度「履歴」を押すと通常の表示に戻ります。
- 再生の速さは、とてもゆっくり・ゆっくり・ふつう・速い・とても速いの5段階から選べます。
- 「この版に戻す」を押すと、その版の内容が新しい編集として追加されます。これまでの履歴は消えません。
- メモの本文はウィンドウの幅に合わせて広がります。行番号は、折り返した行も1行として数え、履歴の表示にも付きます。これらの設定は次回も使われます。

**検索と置換**

- 検索は「最新の版」と「履歴すべて」から選べます。「履歴すべて」では、消したあとの文字も、書かれていた箇所ごとに見つかります。
- 検索と置換では、大文字/小文字の区別・単語単位・正規表現を選べます。正規表現のときは、置換後の文字列に `$1`(かっこで囲んだ部分)、`$&`(一致した全体)、`\n`(改行)、`\t`(タブ)が使えます。「すべて置換」は1回の編集として履歴に残り、`Ctrl+Z` で元に戻せます。`Ctrl+F` は、これまでどおり全メモを対象にした検索です。

**最近見たメモとメモ同士のリンク**

- 「ファイル」→「最近見たメモ」に、最近開いたメモが新しい順に10件(いま開いているメモを除く)並びます。削除したメモも「(削除済み)」と付けて残り、選ぶとお知らせが出ます。ごみ箱から元に戻したメモは、また開けます。一覧は保存先ごとに控え、「一覧を消去」で空にできます(最近更新したメモは、左側の一覧の上にあります)。
- 「ファイル」→「前に見たメモに戻る」(`Alt+←`)で、今のメモの前に見ていたメモを開きます。続けて押すと元に戻るので、リンクで移動した後などに、2つのメモを行き来できます。
- `[表示する文字](note:メモID)` と書くと、他のメモへのリンクになります。メモID を手で書く必要はありません。「編集」→「メモへのリンクを挿入…」(`Ctrl+K`)で一覧から選ぶ(題名で絞り込めます)か、参照先のメモのプロパティで「このメモへのリンクをコピー」を押して貼り付けます。
- プレビューや履歴の「Markdown表示」ではクリック、編集画面では `Ctrl`+クリックで、そのメモに移動します。マウスを重ねると、参照先の今の題名が出ます。リンクはメモそのものを指し(メモの中の位置は指しません)、参照先の題名や中身が変わっても切れません。参照先を削除すると、リンクは灰色の取り消し線で表示され、クリックするとお知らせが出ます。
- あるメモを参照しているメモを探すには、全メモの検索で `note:` に続けてそのメモID(プロパティに表示されます)を探します。印刷・PDF・テキストへの書き出しでは、リンクは書いたまま出ます。

**数式**

- LaTeX の数式を `$` で囲むと文中の数式(`$E = mc^2$`)、`$$` だけの行で前後を囲むと独立した行の数式になります。`\( … \)`・`\[ … \]`・```` ```math ```` のコードブロックも使えます。化学式は `\ce{…}`(mhchem)で書けます(例: `$\ce{H2O}$`)。
- 数式は、プレビュー、履歴の「Markdown表示」、印刷・PDF で表示されます。編集画面と検索では、LaTeX の文字のまま扱います。
- 「$5 と $10」のような金額が数式にならないよう、Pandoc や GitHub と同じ規則にしています。`$` の内側のすぐ隣に空白を入れないでください。また、閉じの `$` の直後が数字のときは数式になりません。`$` を文字として書くときは `\$` にします。
- 表の中の数式で `|` を使うと、セルの区切りと見なされます。`\vert` と書いてください。
- 誤りのある数式は、元の LaTeX を赤字で表示します。マウスを重ねると誤りの内容が出ます。数式を右クリックして「数式の LaTeX をコピー」を選ぶと、元の LaTeX をコピーできます。
- 数式の表示には、アプリに同梱した [KaTeX](https://katex.org/) を使います(インターネットには接続しません)。よく使う数式コマンドにはほぼ対応していますが、LaTeX のすべてではありません(TikZ などの図や、`\label`・`\ref` には対応しません)。`\href` や `\includegraphics` のように外部を参照するコマンドは使えません。

**行の書式**

- メニューの「編集」→「書式」→「引用」「箇条書き」「番号付きの箇条書き」「コードブロック」(編集画面の右クリックメニューにもあります)で、選択がかかっている行すべてを、選んでいなければカーソルのある行を、まとめてその書式にします。選択の終わりが行の先頭ちょうどのときは、その行は含めません。
- 引用は各行の先頭に `> ` を付けます(空の行には `>` を付けて、引用が途切れないようにします)。箇条書きと番号付きは、字下げの後に `- ` や `1. `・`2. `… を付け、空の行は飛ばします。箇条書きと番号付きは互いに切り替わります。コードブロックは、対象の行の前後に ```` ``` ```` だけの行を入れます。
- すべての行がすでにその書式なら、外します(コードブロックは、前後が ```` ``` ```` の行のとき)。表や見出しの行も区別せずに処理します。
- 1回の編集として履歴に残り、`Ctrl+Z` で元に戻せます。編集画面で使えます。

**画像・ファイルの添付**

- 編集画面で、コピーした画像(スクリーンショットなど)を貼り付けるか、ファイルをウィンドウへドラッグ&ドロップするか、「添付」ボタンでファイルを選びます。カーソルの位置に `![名前](attach:…)`(画像)や `[名前](attach:…)`(ファイル)が入り、プレビューと履歴の「Markdown表示」で画像やファイルへのリンクとして表示されます。表の行の中に貼ると、そのセルに入ります(複数のときは横に並びます)。画像やリンクをクリックすると開きます。実行ファイルなどは開かず、保存先のフォルダで場所を示します。
- ファイルの実体は、そのメモの `.files` フォルダに保存されます。**本文から消しても、履歴の古い版で見られるように、アプリはファイルを削除しません。** 同じ内容のファイルは1つだけ保存します。1ファイル 50MB までです。
- `attach:` の前の「名前」の部分は自由に書き換えられます(`|`、`[`、`]` は使わないでください)。添付の記法を別のメモにコピーしても、そのメモにはファイルの実体がないので表示されません。ファイルを貼り付け直してください。
- 本文の下に、そのメモで使っている添付の一覧(サムネイル)が表示されます。
- 画像を右クリックすると(プレビュー、履歴の「Markdown表示」、添付の一覧)、「画像をコピー」「画像を開く」「画像の場所を開く」「名前をつけて画像を保存…」のメニューが出ます。ファイルへのリンクを右クリックすると「ファイルを開く」「ファイルの場所を開く」が出ます。左クリックすると、これまでどおり開きます。

**インポートとエクスポート**

- 「ファイル」→「インポート…」(`Ctrl+O`)で、EverPad アーカイブ(`.everpad`)とテキストファイルを取り込みます。中身で見分けるので、両方の種類をまとめて選べます。
- 「ファイル」→「エクスポート」には、「テキストファイル…」(`Ctrl+Shift+E`)、「PDF…」(`Ctrl+Shift+P`。「印刷と PDF」を参照)、「EverPad アーカイブ…」の3つの形式があります。印刷(「ファイル」→「印刷…」)はファイルを作らないので、別の項目にしています。
- ファイルを選ぶ窓は、前回使ったフォルダを開きます。インポートとエクスポートで別々に覚え(エクスポートは、どの形式も「名前をつけて画像を保存…」も同じフォルダを共有します)、EverPad を終了しても引き継ぎます。初めてのときや、そのフォルダが無くなったときは、インポートは保存先フォルダ、エクスポートはドキュメントを開きます。

**EverPad アーカイブ**

- 「ファイル」→「エクスポート」→「EverPad アーカイブ…」で、今のメモの本文・全履歴・添付を1つの `.everpad` ファイルに保存します(履歴の表示中でも、メモ全体を保存します)。中身は ZIP 形式で、拡張子を `.zip` に変えると中を見られます(`manifest.json`・`note.jsonl`・`note.md`・`files/`)。
- アーカイブをインポートすると、履歴と添付ごとメモが戻ります。同じ ID のメモが既にあるときは、次から選びます。**上書き**は、いまあるメモの本文・履歴・添付をアーカイブの内容に置き換えます(EverPad からは元に戻せません。元のファイルはごみ箱に移ります)。**新しい ID で取り込む**は、別のメモとして取り込みます。**中止**は何もしません。
- インポートしたメモは、一覧のいちばん上に出ます。インポートした日時を履歴ファイルの見出し行に記録し(古いバージョンの EverPad はこの項目を無視します)、一覧は「最後に編集した日時」と「インポートした日時」の新しいほうで並べます。インポートした日時はプロパティに出ます。
- インストーラーが `.everpad` ファイルを EverPad に関連付けるので、アーカイブをダブルクリックするとインポートします。「送る」や、EverPad のアイコンへのドラッグ&ドロップでもインポートできます。
- インポートの前に、形式・メモID・履歴・添付のファイル名・大きさを確かめます。壊れたアーカイブや正しくないアーカイブは取り込みません。

**テキストファイルのインポート**

- 1ファイルが1つの新しいメモになり、最初の行が題名になります。
- エクスプローラーでファイルを選び、「送る」→「EverPad」でも取り込めます。EverPad が起動していなければ起動します。「送る」メニューに追加するには、インストール時にチェックボックスを付けるか、いつでも「ファイル」→「「送る」メニューに登録」を選びます(もう一度選ぶと解除します)。EverPad のアイコンにファイルをドラッグ&ドロップしても取り込めます。EverPad のウィンドウへのドラッグ&ドロップは、これまでどおり添付になります。
- 文字コードは自動で見分けます(UTF-8(BOM あり・なし)、UTF-16、Shift_JIS、EUC-JP、ISO-2022-JP)。改行は LF にそろえます。10MB を超えるファイル、テキストでないファイル、文字として読めないデータを含むファイルは取り込まず、理由を表示します。読めないデータがあるときは「Shift_JIS として 12行目の 5文字目…(0x82 0xFF)」のように場所も示します。
- 取り込んだメモは EverPad のメモで、元のファイルとは関係を持ちません(どこから取り込んだかも記録しません)。
- 「ファイル」→「エクスポート」→「テキストファイル…」(`Ctrl+Shift+E`)で、今のメモを `.txt` か `.md` のファイルに保存します(UTF-8・BOM なし、改行は CRLF)。履歴の表示中は、見ている版を書き出します。添付は含まれません。

**印刷と PDF**

- メニューの「ファイル」→「印刷…」(`Ctrl+P`)で、いま開いているメモを印刷します。「ファイル」→「エクスポート」→「PDF…」(`Ctrl+Shift+P`)では PDF として保存します。
- どの表示から実行しても、プレビューと同じ整形した見た目(見出し、表、チェックボックス、添付画像)で出ます。履歴の表示中は、見ている版を出します。
- 各ページの上に題名と最後に編集した日時、下に印刷した日時(PDF では作成した日時)とページ番号が入ります。過去の版を出したときは、版の番号も入ります。
- ダークモードで使っていても、白い紙に黒い文字で出ます。PDF の用紙は A4 です(米国とカナダでは Letter)。

**その他**

- 今の表示で使えないメニューの項目は、グレーアウトします(キー操作も効きません)。「検索と置換…」「画像・ファイルを添付…」「書式」「メモへのリンクを挿入…」は編集画面だけ、「行番号の表示を切り替え」(と右下の「行番号」ボタン)は行番号が出る表示(編集画面と、編集から入った履歴の表示)だけ、「前に見たメモに戻る」は戻れるメモがあるときだけ使えます。
- 左のメモ一覧(と検索結果)でメモを右クリックすると、今開いているメモとは関係なく、そのメモに対する操作のメニューが出ます。「開く」「このメモへのリンクをコピー」「エクスポート」(テキストファイル・PDF・EverPad アーカイブ。最新の版を書き出します)「プロパティ…」「削除…」です。メニューの先頭には対象のメモの題名が出て、メニューを開いている間はその行に枠が付きます。開いていないメモを削除しても、開いているメモはそのままです。
- プレビューでリンクにマウスを重ねると、ブラウザと同じように左下にリンク先(アドレス、参照先のメモの題名、見出し、添付の名前)が出ます。ファイルへの相対パスなど EverPad で開けないリンクには「(EverPad では開けません)」と付きます。
- メニューの「ファイル」→「プロパティ…」(`Alt+Enter`)で、今のメモの題名、メモID、作成と最終編集の日時、版数、文字数(改行を含まない)・単語数・行数と、メモを保存しているファイル(履歴の `.jsonl`、本文の `.md`、添付の `.files` フォルダ)の場所と大きさを確認できます。ファイルごとに、エクスプローラーで場所を開くボタンと、パスをコピーするボタンがあります。文字数・単語数・行数は Notepad++ の「要約」と同じ数え方です。単語は、空白・改行と半角の記号 ``\ . , ; : ! ? ( ) + - * / = [ ] { } & ~ " ' ` | @ $ % < > ^`` 以外が続く部分を1語と数えます(全角の句読点は区切りにならないので、日本語の文は長いひと続きとして数えられます)。空のメモは1行です。
- 編集画面(と検索・置換の入力欄)で右クリックすると、元に戻す・やり直し・切り取り・コピー・貼り付け・削除・すべて選択のメニューが出ます。プレビューや履歴では、文字を選んで右クリックするとコピーできます。
- ウィンドウの位置と大きさ(最大化しているかどうかも)は、次の起動で前回閉じたときの状態に戻ります。ディスプレイを外したなどで前回の位置が画面の外になるときは、位置だけ Windows に任せます。
- 画面の言語は、メニューの「表示」→「言語 (Language)」→「日本語」または「English」で切り替えます。選んだ言語は次回も使われます。切り替えても、今の表示(編集・プレビュー・履歴、検索、検索と置換のバー、カーソルやスクロールの位置)はそのまま引き継がれます。
- 画面下の状態表示には、最大3つのまとまりが区切り線で分かれて出ます。**カーソル**(入力位置が何行目の何文字目か。編集画面だけ)、**選択**(選んでいる部分の文字数。複数行なら行数も。選んでいるときだけ)、**全体**(メモ全体の文字数・行数・版数。履歴の表示中は、表示している版の文字数・行数)です。文字数には改行を含めず、行は行番号と同じく改行で区切って数えます(空のメモは1行)。マウスを重ねると、それぞれの説明が出ます。
- メニューの「ヘルプ」→「Markdown の書き方」で、使える書き方を、例と表示結果を並べて確認できます。下の「Markdown の書き方」の表も参照してください。
- 使っているバージョンは、メニューの「ヘルプ」→「EverPad について」で確認できます。Electron のバージョン、メモの保存先、EverPad の公開場所(https://github.com/nihongi/everpad/)も表示され、「GitHub で開く」でブラウザで開けます。

### Markdown の書き方

| 書式 | 書き方 |
|---|---|
| 見出し | `# 見出し1`、`## 見出し2` … `###### 見出し6` |
| 強調 | `**太字**`、`*斜体*`、`~~取り消し線~~`、`` `コード` `` |
| 箇条書き | `- 項目`(`*`・`+` も可。空白2つで字下げすると入れ子)、`1. 項目` |
| チェックボックス | `- [ ] 未完了`、`- [x] 完了` |
| リンク | `[表示する文字](https://example.com)`(ブラウザで開く)、`[表示する文字](#見出し)`(同じメモの見出しへ移動)。相対パスなど、それ以外のリンクはリンクの見た目で表示するが、開けない |
| 引用 | `> 引用する文` |
| コードブロック | ```` ``` ```` だけの行で前後を囲む(`~~~` も可)。中に ```` ``` ```` の行を書くときは ````` ```` ````` で囲む |
| 区切り線 | `---` |
| 表 | `\| a \| b \|` の次に `\|:---\|---:\|`(`:---` 左寄せ、`:---:` 中央、`---:` 右寄せ) |
| 数式 | `$E = mc^2$`(文中)、`$$` だけの行で前後を囲む(独立した行)、`\ce{H2O}`(化学式) |
| 他のメモへのリンク | `[表示する文字](note:メモID)`。`Ctrl+K` で挿入できます |
| 添付 | `![名前](attach:…)`(画像)、`[名前](attach:…)`(ファイル)。添付すると自動で書かれます |

一般的な Markdown と違い、段落の中の改行はそのまま改行になり、画像は添付したものだけが表示され、HTML のタグはそのまま文字として表示されます。

### メモの保存先と形式

既定の保存先は `ドキュメント\EverPad` です。メニューの「ファイル」→「保存先フォルダを変更…」で変えられ、「保存先フォルダを開く」でエクスプローラーが開きます。

1つのメモは、次のファイルとフォルダでできています。

| ファイル | 中身 |
|---|---|
| `<日時>-<英数字>.jsonl` | 編集履歴の本体。1行目がヘッダー、2行目以降が1回ずつの編集 `[位置, 消した文字列, 入れた文字列, 時刻(ミリ秒)]` です。追記だけで増えるので、書き込み中に落ちても過去の履歴は壊れません。 |
| `<日時>-<英数字>.md` | 最新の本文。他のアプリで読むための控えです。全メモの検索では、開いていないメモの最新の本文をここから読みます(履歴より古い場合は、履歴から組み立てます)。 |
| `<日時>-<英数字>.files\` | 貼り付けた画像と添付ファイル(「画像・ファイルの添付」を参照)。添付があるメモだけにできます。 |

このほか保存先には、メモ一覧用の索引 `.everpad-index.json`(題名・版数・更新時刻)があります。起動を速くするための控えで、消えても壊れても自動で作り直されます。

- バックアップは、保存先フォルダをコピーするだけです。
- `.jsonl` が途中で壊れていた場合は、読める範囲までを使い、元のファイルを `.corrupt-…` という名前で残します。
- メモを削除すると、そのメモのファイルと添付のフォルダがごみ箱に入ります。ごみ箱の無いドライブ(USB メモリ、ネットワークのフォルダ)では、Windows が元に戻せない形で消してしまうため、代わりに保存先の中の `.trash` フォルダに移します。アーカイブのインポートでメモを上書きするときも同じです。`.trash` の中身は、要らなくなったらご自身で削除してください。macOS と Linux では OS のゴミ箱に入れ、入れられなかったときだけ `.trash` に移します。
- 1台のパソコンで、同じ保存先を2つの EverPad で同時に開くことはできません。EverPad は開いている間、保存先に `.everpad-lock` を置き、同じ保存先を開こうとした別の EverPad(portable 版など)は、別の保存先を選ぶか終了するかを尋ねます。異常終了で残った印は無視します。OneDrive などで複数のパソコンから同じフォルダを使う場合は、片方の EverPad を閉じてから、もう一方で開いてください。

### メモが増えたときの動き

- 起動時に読むのは、メモ一覧用の索引だけです。各メモの履歴ファイルは、大きさや更新時刻が索引と合わなくなったものだけ読み直します。
- 履歴を含む中身は、開いたメモだけ読み込みます。読み込んだメモは最近使った6件だけ覚えておき、ほかは手放します(編集中や保存待ちのメモは手放しません)。
- メモ一覧は入力のたびには作り直さず、入力が落ち着いてから更新します。
- 全メモの検索は、100件(履歴まで探すときは20件)ずつに分けて進め、検索語を変えると前の検索を打ち切ります。開いていないメモは、読んだあと覚えずに捨てます。「最新の版」の検索は最新の本文だけを読み、履歴は読みません。

### Etherpad からの取り込み

Etherpad(MySQL)のダンプを、EverPad の形式に変換できます。

```
node tools/import-etherpad.js <ダンプファイル> <出力フォルダ>
```

- パッドごとに1つのメモ(`.jsonl` と `.md`)ができ、Etherpad の版を1つずつ再生して履歴にします。変換後の本文が Etherpad の最新の本文と一致しないパッドは取り込まず、メッセージを出します。
- 出力フォルダの中身を EverPad の保存先(`ドキュメント\EverPad`)にコピーすると読めます。コピーは EverPad を閉じてから行ってください。
- 見出しは `#`、箇条書き・インデントは `-`、番号付きは `1.`、太字・斜体・取り消し線は `**` `*` `~~`、表(ep_tables2)は Markdown の表にします。下線・色、作者、チャット、保存した版(しおり)は取り込みません。
- 新規パッドに自動で入る見本の文章(Welcome to Etherpad!)は取り込みません。
- 各メモの1行目に、パッド名を普通の文字として足します。EverPad では最初の行が題名になるので、パッド名が題名になります。足したくないときは `--no-title-line`、特定のパッドだけ足したくないときは `--as-is=パッド名` を付けます。パッド名とメモの ID の対応表は `etherpad-import-map.csv` に出力します。

### ファイルの構成

```
build/           アイコン(icon.ico / icon.png)と、元の画像から作り直すスクリプト(make-icon.py)
contextmenu.js   右クリックメニューの中身
main.js          Electron 本体側(ウィンドウ、メニュー、保存先、ごみ箱)
preload.js       画面に渡す窓口(保存・読み込み・メニュー操作だけ)
store.js         ファイル保存層(Electron なしでテストできる)
windowstate.js   ウィンドウの位置の記憶と復元(Electron なしでテストできる)
portable.js      portable 版(と Linux の AppImage)の設定とメモの保存場所(Electron なしでテストできる)
macmenu.js       macOS のメニューの形とショートカットキー(Electron なしでテストできる)
datalock.js      同じ保存先を2つの EverPad で開かないための印(Electron なしでテストできる)
textcodec.js     取り込むテキストファイルの文字コードの判定(Electron なしでテストできる)
archive.js       EverPad アーカイブの作成・検査・読み込み(Electron なしでテストできる)
ziplite.js       アーカイブに使う最小限の ZIP の読み書き。Node.js の zlib を使う(Electron なしでテストできる)
sendto.js        「送る」メニューのショートカットと、起動時に渡されたファイルの取り出し(Electron なしでテストできる)
renderer/        画面(index.html / styles.css / app.js)、履歴・Markdown・検索のロジック(core.js)、日本語と英語の文言(i18n.js)、
                 「Markdown の書き方」の画面(help.html / help.css / help.js / help-content.js)
tools/           Etherpad からの取り込みツール(import-etherpad.js)と、KaTeX を renderer/vendor/katex にコピーするスクリプト(vendor-katex.js)
renderer/vendor/katex/  数式の表示に使う KaTeX(npm start と npm run dist の前に node_modules から自動でコピーする。Git には入れない)
build/installer.nsh  インストーラーの「送る」メニューと、アンインストーラーの「設定も削除する」のチェックボックス
.github/workflows/build.yml  GitHub Actions で macOS 版と Linux 版を作る
test/            自動テスト
```

### 安全のための設計

- 画像は専用の `everpad-file://` からだけ読み込み、保存先のフォルダの外のファイルは読めません。
- 画面からは Node.js の機能を直接使えない構成(`contextIsolation`、`sandbox`)で、ページの外へ移動することも禁止しています。外部リンクだけは既定のブラウザで開きます。
- インストールしたアプリは、デバッグ用の接続を受け付けません。`--inspect`、`NODE_OPTIONS`、`ELECTRON_RUN_AS_NODE` は実行ファイル自体で無効にしてあり(Electron の fuses)、`--remote-debugging-port` などの起動オプションは無視します。`npm start` での開発時の起動には影響しません。
- インストールしたアプリは、起動時にアプリ本体(`app.asar`)が書き換えられていないかを確かめ、書き換えや差し替えがあれば起動しません(Electron の fuses の OnlyLoadAppFromAsar と EnableEmbeddedAsarIntegrityValidation)。

### 動作確認

- 保存層、ウィンドウの位置の処理、取り込みの文字コードの判定、「送る」メニューの補助、履歴・Markdown・検索のロジック、日本語と英語の文言(すべての項目が両方の言語にそろっていること)は、自動テスト(`npm test`)で確認しています。
- 画面は、保存の窓口を模した部品をつないで Chromium で動かし、入力、巻き戻し、検索、復元、削除、再読み込み後の復元などを確認しています。
- Electron を使った起動(`npm start`)と、画面の操作(編集、巻き戻し、検索など)は、Windows 11・Electron 44.7.0 で確認しています。
- インストーラーの作成(`npm run dist`)は electron-builder 26.15.3 で確認しています。できたインストーラーでのインストールと、インストール後の動作も確認しています。

### ライセンス

MIT License です。全文は [LICENSE](LICENSE) にあります。

Copyright (c) 2026 Nobuyoshi NIHONGI

数式の表示のために [KaTeX](https://github.com/KaTeX/KaTeX)(MIT License、Copyright (c) 2013-2020 Khan Academy and other contributors)を同梱しています。ライセンスは `renderer/vendor/katex/LICENSE` にコピーしてあります。
