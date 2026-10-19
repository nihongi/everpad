# EverPad

[English](#english) | [日本語](#日本語)

## English

EverPad is a note-taking app for Windows. You write in plain text or Markdown (tables included), every single edit is kept in the history, and a time slider lets you rewind a note and watch how it was written. It is built with Electron.

The user interface is available in English and Japanese. The language follows the Windows display language (English for anything other than Japanese), and can be changed at any time from View → Language (言語).

This program was created with the help of Claude Code.

### Features

- **Full edit history**: every edit is recorded. Drag the time slider or play the history back to see any past version, and restore it with one click.
- **Markdown preview**: headings, lists, check boxes, code, links, block quotes and tables.
- **Search across all notes**: search either the latest version of each note or the entire history, including text that has since been deleted.
- **Find and replace**: with case sensitivity, whole-word and regular-expression options.
- **Images and attachments**: paste screenshots or drop files into a note.
- **Print and PDF**: print a note, or save it as a PDF, with the same formatting as the preview.
- **English and Japanese**: switch the interface language from the menu.
- **Plain files**: notes are stored as ordinary files in a folder you choose, so backing up is just copying the folder.

### Requirements

- Windows 10 / 11
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

This creates an installer (`EverPad Setup 0.8.0.exe`) and a portable executable that needs no installation in the `dist` folder. The installer can be shown in English or Japanese. The executables are not code-signed, so Windows may show "Windows protected your PC" the first time you run one. Choose "More info" and then "Run anyway".

### Usage

| Action | Key |
|---|---|
| New note | `Ctrl+N` |
| Search all notes | `Ctrl+F` |
| Print | `Ctrl+P` |
| Save as PDF | `Ctrl+Shift+P` |
| Edit / Preview | `Ctrl+1` / `Ctrl+2` |
| Show / hide history | `Ctrl+3` (or the History button at the top) |
| Attach an image or file | `Ctrl+Shift+U` (or paste with `Ctrl+V`, drag and drop, or the Attach button at the top right) |
| Find and replace (a bar appears above the editor) | `Ctrl+H` |
| Find next / previous | `Enter` / `Shift+Enter` (also `F3` / `Shift+F3` while the bar is open) |
| Show / hide the left pane (note list and search) | `Ctrl+B` (or the menu button at the top left) |
| Show / hide line numbers | `Ctrl+L` (or the Line numbers button at the bottom right) |
| Previous / next version in the history | `←` / `→` |
| Play / pause the history | `Space` |

**Views and history**

- There are two views, Edit and Preview, and each has a history mode. Pressing History shows the time slider while keeping the current view: in Edit, the characters changed in each version are highlighted; in Preview, each version is shown formatted. Switching between Edit and Preview during the history keeps the same version. Press History again to leave the history.
- Playback speed can be set to five levels, from very slow to very fast.
- Restore this version adds the content of that version as a new edit. The existing history is never deleted.
- The note text widens to fit the window. Line numbers count a wrapped line as one line and are also shown in the history. These settings are remembered.

**Search and replace**

- Search can target Latest version or All history. The history search finds every place where the text was ever written, including text that has since been deleted.
- Find and replace supports case sensitivity, whole words and regular expressions. With regular expressions, the replacement can use `$1` (a captured group), `$&` (the whole match), `\n` (newline) and `\t` (tab). Replace all is recorded in the history as a single edit and can be undone with `Ctrl+Z`. `Ctrl+F` remains the search across all notes.

**Images and attachments**

- In the editor, paste a copied image (such as a screenshot), drag and drop a file onto the window, or choose a file with the Attach button. `![name](attach:…)` (image) or `[name](attach:…)` (file) is inserted at the cursor, and is shown as an image or a file link in the preview and in the history's Markdown view. Pasting inside a table row puts the attachment in that cell (several attachments line up side by side). Clicking an image or link opens it; executables and similar files are not opened, but shown in their folder instead.
- The files are kept in the note's `.files` folder. **The app never deletes an attachment, even if you remove it from the text, so that older versions in the history can still show it.** Identical files are stored only once. The size limit is 50 MB per file.
- You may freely edit the "name" part before `attach:` (avoid `|`, `[` and `]`). Copying the attachment syntax into another note does not work, because the file does not exist in that note; paste the file again instead.
- A list of the attachments used in the note (thumbnails) is shown below the text.

**Printing and PDF**

- Choose File → Print… (`Ctrl+P`) to print the current note, or File → Save as PDF… (`Ctrl+Shift+P`) to save it as a PDF.
- The note is printed with the same formatting as the preview (headings, tables, check boxes and attached images), whichever view you are in. While the history is shown, the version you are viewing is printed.
- Each page shows the note title and the time of the last edit at the top, and the time it was printed (or the PDF was created) and the page number at the bottom. When a past version is printed, its version number is shown too.
- Even in dark mode, notes are printed as dark text on white paper. PDFs use A4 paper (Letter in the United States and Canada).

**Other**

- Right-click in the editor (or in the find and replace fields) for undo, redo, cut, copy, paste, delete and select all. In the preview and the history, select text and right-click to copy.
- The window position and size (including whether it was maximized) are restored at the next start. If the previous position would be off screen, for example because a display was disconnected, the position is left to Windows.
- To change the interface language, choose View → Language (言語) → English or 日本語. The setting is remembered, and the current view (Edit, Preview or history, the search, the find and replace bar, the cursor and scroll position) is kept when switching.
- To check the version you are running, choose Help → About EverPad from the menu. It also shows the Electron version and the data folder.

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
- Deleting a note moves its files and its attachment folder to the Recycle Bin.
- Do not open the same data folder from two apps at the same time (EverPad itself prevents a second instance). If you share the folder between computers with OneDrive or similar, close EverPad on one computer before opening it on another.

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
renderer/        The UI (index.html / styles.css / app.js), the history, Markdown and search logic (core.js), and the English and Japanese texts (i18n.js)
tools/           The Etherpad import tool (import-etherpad.js)
test/            Automated tests
```

### Security

- Images are loaded only through the dedicated `everpad-file://` scheme, which cannot read files outside the data folder.
- The UI cannot use Node.js directly (`contextIsolation` and `sandbox` are enabled) and cannot navigate away from the app. Only external links are opened, in the default browser.
- The installed app does not accept debugging connections: `--inspect`, `NODE_OPTIONS` and `ELECTRON_RUN_AS_NODE` are disabled in the executable itself (Electron fuses), and `--remote-debugging-port` and similar switches are ignored. Development runs with `npm start` are not affected.
- The installed app checks at startup that its code (`app.asar`) has not been modified, and refuses to start if it has been changed or replaced (Electron fuses: OnlyLoadAppFromAsar and EnableEmbeddedAsarIntegrityValidation).

### Testing

- The storage layer, the window position logic, the history, Markdown and search logic, and the English and Japanese texts (every key exists in both languages) are covered by automated tests (`npm test`).
- The UI has been tested in Chromium with a stand-in for the storage bridge: typing, rewinding, search, restore, delete, and recovery after reload.
- Running the app with Electron (`npm start`) has been tested on Windows 11 with Electron 44.7.0, including editing, rewinding and search.
- Building the installer (`npm run dist`) has been tested with electron-builder 26.15.3, together with installing and using the installed app.

### License

MIT License. See [LICENSE](LICENSE) for the full text.

Copyright (c) 2026 Nobuyoshi NIHONGI

---

## 日本語

EverPad は Windows 用のメモ帳です。テキストまたは Markdown(表を含む)で書けて、1回ごとの編集がすべて履歴に残り、タイムスライダーで巻き戻して書いた過程を見られます。Electron で作っています。

画面は日本語と英語に対応しています。最初は Windows の表示言語に合わせ(日本語以外のときは英語)、メニューの「表示」→「言語 (Language)」でいつでも切り替えられます。

このプログラムは Claude Code を活用して作成しました。

### 特長

- **すべての編集を履歴に残す**: タイムスライダーを動かすか履歴を再生すると、どの時点の版でも見られます。その版にはボタン1つで戻せます。
- **Markdown のプレビュー**: 見出し、箇条書き、チェックボックス、コード、リンク、引用、表に対応しています。
- **全メモの検索**: 各メモの最新の版だけでなく、消したあとの文字も含めて履歴全体から探せます。
- **検索と置換**: 大文字/小文字の区別、単語単位、正規表現を選べます。
- **画像・ファイルの添付**: スクリーンショットを貼り付けたり、ファイルをドラッグ&ドロップしたりできます。
- **印刷と PDF**: メモを、プレビューと同じ整形した見た目で印刷したり、PDF として保存したりできます。
- **日本語と英語**: 画面の言語をメニューから切り替えられます。
- **普通のファイルで保存**: メモは選んだフォルダに普通のファイルとして保存されるので、バックアップはフォルダをコピーするだけです。

### 動かすために必要なもの

- Windows 10 / 11
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

`dist` フォルダに、インストーラー(`EverPad Setup 0.8.0.exe`)と、インストール不要の実行ファイル(portable 版)ができます。インストーラーは日本語と英語を選べます。署名はしていないため、初めて実行するときに Windows が「Windows によって PC が保護されました」と表示することがあります。その場合は「詳細情報」→「実行」を選びます。

### 使い方

| 操作 | キー |
|---|---|
| 新しいメモ | `Ctrl+N` |
| 全メモから検索 | `Ctrl+F` |
| 印刷 | `Ctrl+P` |
| PDF として保存 | `Ctrl+Shift+P` |
| 編集 / プレビュー | `Ctrl+1` / `Ctrl+2` |
| 履歴表示の切り替え | `Ctrl+3`(画面上部の「履歴」ボタンでも) |
| 画像・ファイルを添付 | `Ctrl+Shift+U`(`Ctrl+V` での貼り付け、ドラッグ&ドロップ、右上の「添付」ボタンでも) |
| 検索と置換(編集画面の上にバーが出ます) | `Ctrl+H` |
| 次を検索 / 前を検索 | `Enter` / `Shift+Enter`(バーを開いている間は `F3` / `Shift+F3` でも) |
| 左側(メモ一覧と検索)の表示 / 非表示 | `Ctrl+B`(左上の三本線ボタンでも) |
| 行番号の表示 / 非表示 | `Ctrl+L`(右下の「行番号」ボタンでも) |
| 履歴で1つ前 / 1つ先の版へ | `←` / `→` |
| 履歴の再生 / 停止 | `Space` |

**表示と履歴**

- 表示は「編集」と「プレビュー」の2つで、どちらにも履歴の表示があります。「履歴」ボタンを押すと、いまの表示のままタイムスライダーが出ます。編集の履歴では、その版で変わった文字が色で示され、プレビューの履歴では、その版が整形して表示されます。履歴の表示中に「編集」「プレビュー」を押すと、同じ版のまま切り替わります。もう一度「履歴」を押すと通常の表示に戻ります。
- 再生の速さは、とてもゆっくり・ゆっくり・ふつう・速い・とても速いの5段階から選べます。
- 「この版に戻す」を押すと、その版の内容が新しい編集として追加されます。これまでの履歴は消えません。
- メモの本文はウィンドウの幅に合わせて広がります。行番号は、折り返した行も1行として数え、履歴の表示にも付きます。これらの設定は次回も使われます。

**検索と置換**

- 検索は「最新の版」と「履歴すべて」から選べます。「履歴すべて」では、消したあとの文字も、書かれていた箇所ごとに見つかります。
- 検索と置換では、大文字/小文字の区別・単語単位・正規表現を選べます。正規表現のときは、置換後の文字列に `$1`(かっこで囲んだ部分)、`$&`(一致した全体)、`\n`(改行)、`\t`(タブ)が使えます。「すべて置換」は1回の編集として履歴に残り、`Ctrl+Z` で元に戻せます。`Ctrl+F` は、これまでどおり全メモを対象にした検索です。

**画像・ファイルの添付**

- 編集画面で、コピーした画像(スクリーンショットなど)を貼り付けるか、ファイルをウィンドウへドラッグ&ドロップするか、「添付」ボタンでファイルを選びます。カーソルの位置に `![名前](attach:…)`(画像)や `[名前](attach:…)`(ファイル)が入り、プレビューと履歴の「Markdown表示」で画像やファイルへのリンクとして表示されます。表の行の中に貼ると、そのセルに入ります(複数のときは横に並びます)。画像やリンクをクリックすると開きます。実行ファイルなどは開かず、保存先のフォルダで場所を示します。
- ファイルの実体は、そのメモの `.files` フォルダに保存されます。**本文から消しても、履歴の古い版で見られるように、アプリはファイルを削除しません。** 同じ内容のファイルは1つだけ保存します。1ファイル 50MB までです。
- `attach:` の前の「名前」の部分は自由に書き換えられます(`|`、`[`、`]` は使わないでください)。添付の記法を別のメモにコピーしても、そのメモにはファイルの実体がないので表示されません。ファイルを貼り付け直してください。
- 本文の下に、そのメモで使っている添付の一覧(サムネイル)が表示されます。

**印刷と PDF**

- メニューの「ファイル」→「印刷…」(`Ctrl+P`)で、いま開いているメモを印刷します。「ファイル」→「PDF として保存…」(`Ctrl+Shift+P`)では PDF として保存します。
- どの表示から実行しても、プレビューと同じ整形した見た目(見出し、表、チェックボックス、添付画像)で出ます。履歴の表示中は、見ている版を出します。
- 各ページの上に題名と最後に編集した日時、下に印刷した日時(PDF では作成した日時)とページ番号が入ります。過去の版を出したときは、版の番号も入ります。
- ダークモードで使っていても、白い紙に黒い文字で出ます。PDF の用紙は A4 です(米国とカナダでは Letter)。

**その他**

- 編集画面(と検索・置換の入力欄)で右クリックすると、元に戻す・やり直し・切り取り・コピー・貼り付け・削除・すべて選択のメニューが出ます。プレビューや履歴では、文字を選んで右クリックするとコピーできます。
- ウィンドウの位置と大きさ(最大化しているかどうかも)は、次の起動で前回閉じたときの状態に戻ります。ディスプレイを外したなどで前回の位置が画面の外になるときは、位置だけ Windows に任せます。
- 画面の言語は、メニューの「表示」→「言語 (Language)」→「日本語」または「English」で切り替えます。選んだ言語は次回も使われます。切り替えても、いまの表示(編集・プレビュー・履歴、検索、検索と置換のバー、カーソルやスクロールの位置)はそのまま引き継がれます。
- 使っているバージョンは、メニューの「ヘルプ」→「EverPad について」で確認できます。Electron のバージョンと、メモの保存先も表示されます。

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
- メモを削除すると、そのメモのファイルと添付のフォルダがごみ箱に入ります。
- 同じ保存先を2つのアプリで同時に開かないでください(EverPad 自体は二重起動を防ぎます)。OneDrive などで複数のパソコンから同じフォルダを使う場合は、片方の EverPad を閉じてから、もう一方で開いてください。

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
renderer/        画面(index.html / styles.css / app.js)、履歴・Markdown・検索のロジック(core.js)、日本語と英語の文言(i18n.js)
tools/           Etherpad からの取り込みツール(import-etherpad.js)
test/            自動テスト
```

### 安全のための設計

- 画像は専用の `everpad-file://` からだけ読み込み、保存先のフォルダの外のファイルは読めません。
- 画面からは Node.js の機能を直接使えない構成(`contextIsolation`、`sandbox`)で、ページの外へ移動することも禁止しています。外部リンクだけは既定のブラウザで開きます。
- インストールしたアプリは、デバッグ用の接続を受け付けません。`--inspect`、`NODE_OPTIONS`、`ELECTRON_RUN_AS_NODE` は実行ファイル自体で無効にしてあり(Electron の fuses)、`--remote-debugging-port` などの起動オプションは無視します。`npm start` での開発時の起動には影響しません。
- インストールしたアプリは、起動時にアプリ本体(`app.asar`)が書き換えられていないかを確かめ、書き換えや差し替えがあれば起動しません(Electron の fuses の OnlyLoadAppFromAsar と EnableEmbeddedAsarIntegrityValidation)。

### 動作確認

- 保存層、ウィンドウの位置の処理、履歴・Markdown・検索のロジック、日本語と英語の文言(すべての項目が両方の言語にそろっていること)は、自動テスト(`npm test`)で確認しています。
- 画面は、保存の窓口を模した部品をつないで Chromium で動かし、入力、巻き戻し、検索、復元、削除、再読み込み後の復元などを確認しています。
- Electron を使った起動(`npm start`)と、画面の操作(編集、巻き戻し、検索など)は、Windows 11・Electron 44.7.0 で確認しています。
- インストーラーの作成(`npm run dist`)は electron-builder 26.15.3 で確認しています。できたインストーラーでのインストールと、インストール後の動作も確認しています。

### ライセンス

MIT License です。全文は [LICENSE](LICENSE) にあります。

Copyright (c) 2026 Nobuyoshi NIHONGI
