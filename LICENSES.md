# Licenses

[日本語](LICENSES.ja.md)

## EverPad

EverPad is released under the MIT License. See [LICENSE](LICENSE) for the full text.

Copyright (c) 2026 Nobuyoshi NIHONGI

## Software contained in the app

Follow the links to read each license.

| Software | Used for | License |
|---|---|---|
| [Electron](https://github.com/electron/electron) | The base of the app | [MIT License](https://github.com/electron/electron/blob/main/LICENSE) (Copyright (c) Electron contributors, Copyright (c) 2013-2020 GitHub Inc.) |
| [Chromium](https://www.chromium.org/) | Showing the window (part of Electron) | [BSD 3-Clause License](https://chromium.googlesource.com/chromium/src/+/main/LICENSE) (Copyright 2015 The Chromium Authors) |
| [Node.js](https://nodejs.org/) | Reading and saving files (part of Electron) | [MIT License](https://github.com/nodejs/node/blob/main/LICENSE) (Copyright Node.js contributors) |
| [KaTeX](https://github.com/KaTeX/KaTeX) | Showing math | [MIT License](https://github.com/KaTeX/KaTeX/blob/main/LICENSE) (Copyright (c) 2013-2020 Khan Academy and other contributors) |
| [Mermaid](https://github.com/mermaid-js/mermaid) | Drawing diagrams | [MIT License](https://github.com/mermaid-js/mermaid/blob/develop/LICENSE) (Copyright (c) 2014 - 2022 Knut Sveidqvist) |
| [gemoji](https://github.com/wooorm/gemoji) | The list of emoji names (`renderer/emoji.js`) | [MIT License](https://github.com/wooorm/gemoji/blob/main/license) (Copyright (c) 2014 Titus Wormer) |

Chromium and Node.js use many other libraries. Their licenses come with the app in `LICENSES.chromium.html`, next to `EverPad.exe` (with `LICENSE.electron.txt` for Electron). The licenses of KaTeX and Mermaid, including those of the libraries bundled in Mermaid, are also inside the app.

The other npm packages in `package.json` are used only to build and test EverPad and are not part of the app.

In EverPad, the Licenses button in Help → About EverPad opens this page.
