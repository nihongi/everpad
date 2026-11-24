# ライセンス

[English](LICENSES.md)

## EverPad

EverPad は MIT License で公開しています。全文は [LICENSE](LICENSE) にあります。

Copyright (c) 2026 Nobuyoshi NIHONGI

## アプリに入っているソフトウェア

それぞれのライセンスは、リンク先で読めます。

| ソフトウェア | 使い道 | ライセンス |
|---|---|---|
| [Electron](https://github.com/electron/electron) | アプリの土台 | [MIT License](https://github.com/electron/electron/blob/main/LICENSE)(Copyright (c) Electron contributors、Copyright (c) 2013-2020 GitHub Inc.) |
| [Chromium](https://www.chromium.org/) | 画面の表示(Electron に含まれる) | [BSD 3-Clause License](https://chromium.googlesource.com/chromium/src/+/main/LICENSE)(Copyright 2015 The Chromium Authors) |
| [Node.js](https://nodejs.org/) | ファイルの読み書き(Electron に含まれる) | [MIT License](https://github.com/nodejs/node/blob/main/LICENSE)(Copyright Node.js contributors) |
| [KaTeX](https://github.com/KaTeX/KaTeX) | 数式の表示 | [MIT License](https://github.com/KaTeX/KaTeX/blob/main/LICENSE)(Copyright (c) 2013-2020 Khan Academy and other contributors) |
| [Mermaid](https://github.com/mermaid-js/mermaid) | 図の表示 | [MIT License](https://github.com/mermaid-js/mermaid/blob/develop/LICENSE)(Copyright (c) 2014 - 2022 Knut Sveidqvist) |
| [gemoji](https://github.com/wooorm/gemoji) | 絵文字の名前の一覧(`renderer/emoji.js`) | [MIT License](https://github.com/wooorm/gemoji/blob/main/license)(Copyright (c) 2014 Titus Wormer) |

Chromium と Node.js は、ほかにも多くのライブラリを使っています。それらのライセンスは、アプリの `EverPad.exe` と同じフォルダの `LICENSES.chromium.html` に入っています(Electron のものは `LICENSE.electron.txt`)。KaTeX と Mermaid のライセンス(Mermaid に含まれるライブラリのものも)も、アプリの中に入っています。

`package.json` にあるほかの npm パッケージは、EverPad を作ることと試験にだけ使い、アプリには入っていません。

EverPad の「ヘルプ」→「EverPad について」の「ライセンス」ボタンで、このページを開けます。
