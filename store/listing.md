# Microsoft Store の掲載文(下書き)

Partner Center の「Store 登録情報」に、言語ごとに貼り付けます。文字数の上限は Partner Center の画面の表示に従ってください(下の上限は目安です)。
価格(無料かどうか)は書いていません。無料にする場合は、説明文の最後の段落に「無料で使えます」などを足せます。

Store に出ている版: 0.32.0(「この版の新機能」は、この版の内容です。Store の更新を見送った版があるときは、次の更新の「この版の新機能」に、この版より後の変更をまとめて書きます)

---

## 日本語(ja-JP)

### 製品名

EverPad

### 短い説明(1,000 文字まで)

テキストと Markdown で書けるメモ帳です。すべての編集を履歴に残し、タイムスライダーでメモを巻き戻して、書いていった様子を見返せます。メモは、選んだフォルダに普通のファイルとして保存します。アカウントは不要で、インターネットにも接続しません。

### 説明(10,000 文字まで)

EverPad は、直感的に使えて、すべてを記録するメモ帳です。

1文字の入力から大きな書き換えまで、すべての編集を履歴に残します。タイムスライダーを動かしたり、履歴を再生したりすると、メモがどう書かれていったかを見返せます。消してしまった文章も、過去の版を開けばそこにあり、ワンクリックで元に戻せます。

■ 書く  
・プレーンテキストでも Markdown でも書けます。見出し、リスト、チェックボックス、コード、引用、表、リンクをプレビューで整形して表示します。  
・プレビューのままでも、クリックした段落やリストをその場で書き換えられます。空の表の挿入もでき、表はセルごとに編集でき、右クリックで行・列の挿入と削除、左寄せ・中央揃え・右寄せができます。チェックボックスは押すだけで切り替わります。  
・テキストとプレビューを切り替えても、見ていた場所はそのままです。  
・選んだ文字を、右クリックで太字・斜体・取り消し線・コードにできます。  
・GitHub と同じ書き方で、絵文字(:smile: など。打つと候補が出ます)、色付きの注意書き(アラート)、脚注を書けます。  
・LaTeX の数式と化学式を、整った数式として表示します。数式エディタでは、典型的な数式のひな型や記号を選んで、プレビューを見ながら書けます。  
・Mermaid の書き方で、フローチャートやシーケンス図などの図を描けます。  
・スクリーンショットの貼り付けや、ファイルのドラッグ&ドロップで、画像やファイルをメモに添付できます。  
・他のメモへのリンクを入れて、メモどうしをつなげられます。  
・検索と置換(大文字と小文字の区別、単語単位、正規表現)、行番号、自動インデントに対応しています。  
・キーボードショートカットを、好きなキーに変えられます。

■ 見返す  
・タイムスライダーで、どの時点の版でも表示できます。履歴の再生もできます。  
・変更のあった場所を表示するので、何をいつ書き換えたかがわかります。  
・すべてのメモから検索できます。最新の版だけでなく、履歴全体(あとで消した文章も含む)を検索することもできます。  
・履歴の表示で検索すると、その言葉がある版の範囲をタイムスライダーに色の帯で示すので、いつ書いて、いつ消したかがわかります。

■ 残す・渡す  
・メモは、選んだフォルダに普通のファイルとして保存します。バックアップはフォルダをコピーするだけです。  
・印刷、PDF、HTML、MHTML、AsciiDoc、Word 文書(.docx)、LaTeX(.tex)に書き出せます。Word では見出しのスタイルが付き、数式は Word で編集できる数式になります。LaTeX では数式を書いたまま渡せるので、論文やレポートの原稿にそのまま使えます。  
・EverPad アーカイブ(.everpad)には、メモの本文・すべての履歴・添付ファイルがまとめて入ります。別のパソコンへの引っ越しや受け渡しに使えます。  
・書き終えたメモは読み取り専用にして、うっかり書き換えないように守れます。

■ 安心して使える  
・アカウントは不要です。広告も、利用状況の収集もありません。  
・EverPad がインターネットに接続することはありません。メモはあなたのパソコンから出ていきません。  
・画面は日本語と英語に対応しています。ダークモードにも対応しています。

EverPad はオープンソース(MIT ライセンス)です。ソースコードは https://github.com/nihongi/everpad/ で公開しています。

### この版の新機能(1,500 文字まで)

・メモを LaTeX(.tex)に書き出せるようになりました。「ファイル」→「エクスポート」→「LaTeX…」か、メモ一覧の右クリックの「エクスポート」から使えます。数式と化学式は書いた LaTeX のまま入るので、論文やレポートの原稿として続きを書けます。見出し、リスト、表、コード、脚注、アラート、リンクを変換し、添付の画像と図はファイルの隣のフォルダに置きます。LuaLaTeX でコンパイルしてください(Overleaf では、コンパイラーに LuaLaTeX を選んでください)。

### 製品の機能(20 項目まで、各 200 文字まで)

1. すべての編集を履歴に残し、タイムスライダーで巻き戻せる
2. 過去の版をワンクリックで復元
3. Markdown のプレビュー(見出し・リスト・チェックボックス・表・コード・引用)
4. LaTeX の数式と化学式の表示
5. すべてのメモから検索(履歴全体の検索も可能)
6. 検索と置換(正規表現にも対応)
7. 画像の貼り付けとファイルの添付
8. 他のメモへのリンク
9. 印刷と、PDF・HTML・MHTML・AsciiDoc・Word・LaTeX への書き出し
10. 履歴と添付ファイルごと移せる EverPad アーカイブ
11. メモは選んだフォルダに普通のファイルとして保存
12. アカウント不要、インターネットに接続しない
13. 日本語と英語の画面、ダークモード
14. Mermaid の図(フローチャート・シーケンス図など)
15. プレビューのままで段落・表・チェックボックスを編集でき、表の行・列の挿入と削除・配置も簡単
16. 選んだ文字を右クリックで太字・斜体・取り消し線・コードに
17. キーボードショートカットを好きなキーに変えられる
18. GitHub と同じ絵文字ショートコード(入力候補つき)・アラート・脚注
19. メモを読み取り専用にして、うっかり書き換えを防げる
20. 検索した言葉をいつ書いて、いつ消したかを、タイムスライダーの色の帯で表示

### 検索キーワード(7 個まで、各 30 文字まで)

メモ帳 / Markdown / 履歴 / バージョン管理 / テキストエディター / 数式 / ノート

### 著作権と商標の情報

Copyright (c) 2026 Nobuyoshi NIHONGI

### その他の項目

- プライバシーポリシーの URL: https://github.com/nihongi/everpad/blob/master/PRIVACY.md
- Web サイト: https://github.com/nihongi/everpad/
- サポートの連絡先: https://github.com/nihongi/everpad/issues
- スクリーンショット: 1 枚以上が必要です(1366×768 以上を推奨)。

---

## English (en-US)

### Product name

EverPad

### Short description (up to 1,000 characters)

A note-taking app for plain text and Markdown that keeps every edit. Rewind any note with the time slider and watch how it was written. Notes are saved as ordinary files in a folder you choose. No account needed, and it never connects to the internet.

### Description (up to 10,000 characters)

EverPad is an intuitive notepad that records everything.

Every edit, from a single character to a full rewrite, is kept in the history. Drag the time slider or play the history back to see how a note was written. Text you deleted is still there in the earlier versions, and you can restore any version with one click.

WRITE  
• Write in plain text or Markdown. Headings, lists, check boxes, code, block quotes, tables and links are formatted in the preview.  
• Edit right in the preview: click a paragraph or a list to change it in place. Insert an empty table, edit tables cell by cell, and right-click to insert or delete rows and columns or to align a column left, center or right. Check boxes switch with a click.  
• Switching between Text and Preview keeps your place.  
• Make selected text bold, italic, struck through or code from the right-click menu.  
• Use GitHub's emoji shortcodes (such as :smile:, with suggestions as you type), alerts and footnotes.  
• LaTeX math and chemical formulas are shown as formatted formulas. The formula editor lets you pick templates and symbols and see the result as you type.  
• Draw flowcharts, sequence diagrams and other diagrams with Mermaid syntax.  
• Paste screenshots or drop files to attach images and files to a note.  
• Link notes to each other.  
• Find and replace (with case sensitivity, whole-word and regular-expression options), line numbers and automatic indentation.  
• Change the keyboard shortcuts to the keys you like.

LOOK BACK  
• Show the note at any point in its history with the time slider, or play the history back.  
• See where each change was made, so you know what was rewritten and when.  
• Search all notes: the latest version of each note, or the entire history, including text that was later deleted.  
• Search in the history, and colored bands on the time slider show the versions that contain the text, so you can see when it was written and when it was deleted.

KEEP AND SHARE  
• Notes are saved as ordinary files in a folder you choose. Backing up is just copying the folder.  
• Print, or export to PDF, HTML, MHTML, AsciiDoc, Word (.docx) or LaTeX (.tex). Word documents get heading styles, and formulas become Word equations you can edit. LaTeX files keep formulas exactly as written, ready for papers and reports.  
• An EverPad archive (.everpad) holds a note's text, its whole history and its attachments, for moving notes to another PC or sharing them.  
• Make a finished note read-only so it cannot be changed by accident.

PRIVATE BY DESIGN  
• No account, no advertising and no usage tracking.  
• EverPad never connects to the internet. Your notes do not leave your PC.  
• The interface is available in English and Japanese, with dark mode.

EverPad is open source (MIT License). The source code is at https://github.com/nihongi/everpad/.

### What's new in this version (up to 1,500 characters)

• Notes can now be exported to LaTeX (.tex): choose File → Export → LaTeX…, or Export when you right-click a note in the note list. Formulas and chemical formulas keep the LaTeX you wrote, so you can continue a note as a paper or a report. Headings, lists, tables, code, footnotes, alerts and links are converted, and attached images and diagrams are put in a folder next to the file. Compile it with LuaLaTeX (on Overleaf, choose LuaLaTeX as the compiler).

### Product features (up to 20, up to 200 characters each)

1. Every edit is kept; rewind any note with the time slider
2. Restore any earlier version with one click
3. Markdown preview: headings, lists, check boxes, tables, code and block quotes
4. LaTeX math and chemical formulas
5. Search all notes, including their entire history
6. Find and replace, with regular expressions
7. Paste images and attach files
8. Links between notes
9. Print, and export to PDF, HTML, MHTML, AsciiDoc, Word and LaTeX
10. EverPad archives that move a note with its history and attachments
11. Notes saved as ordinary files in a folder you choose
12. No account, and no internet connection
13. English and Japanese interface, with dark mode
14. Mermaid diagrams: flowcharts, sequence diagrams and more
15. Edit paragraphs, tables and check boxes right in the preview, with easy row, column and alignment changes for tables
16. Bold, italic, strikethrough and code from the right-click menu
17. Keyboard shortcuts you can change
18. GitHub emoji shortcodes (with suggestions), alerts and footnotes
19. Read-only notes that cannot be changed by accident
20. Colored bands on the time slider show when searched text was written and deleted

### Search terms (up to 7, up to 30 characters each)

notes / Markdown / notepad / version history / text editor / math / journal

### Copyright and trademark info

Copyright (c) 2026 Nobuyoshi NIHONGI

### Other fields

- Privacy policy URL: https://github.com/nihongi/everpad/blob/master/PRIVACY.md
- Website: https://github.com/nihongi/everpad/
- Support contact info: https://github.com/nihongi/everpad/issues
- Screenshots: at least one is required (1366×768 or larger is recommended).
