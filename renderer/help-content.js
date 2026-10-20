'use strict';
/* 「Markdown の書き方」の内容(日本語と英語)。help.js が画面に出し、テストでは require で読む。
   noRender: 表示結果を出さない例(添付は実際のファイルが無いと表示できないため) */
(function (root) {
  const F = '```';
  const HELP = {
    ja: {
      title: 'Markdown の書き方',
      intro: 'EverPad で使える Markdown の書き方です。左が書き方、右がプレビューでの表示です。',
      diffTitle: 'ほかの Markdown との違い',
      diffs: [
        '段落の中の改行は、そのまま改行として表示されます(行末に空白を2つ入れる必要はありません)。',
        '画像として表示されるのは、EverPad に添付した画像だけです。ネット上の画像は表示しません。',
        'リンクにできるのは http:// か https:// で始まるアドレスだけです。クリックすると既定のブラウザで開きます。',
        'HTML のタグは、そのまま文字として表示されます。'
      ],
      src: '書き方', out: '表示',
      sections: [
        { h: '見出し', note: '行の先頭に # を書き、空白を1つ入れます。# の数(1〜6)で大きさが変わります。最初の行は、メモ一覧の題名になります。',
          src: '# 見出し1\n## 見出し2\n### 見出し3' },
        { h: '段落と改行', note: '改行はそのまま改行になります。空の行を入れると、段落が分かれます。',
          src: '1行目\n2行目\n\n空の行のあとは、次の段落です。' },
        { h: '文字の強調', note: '',
          src: '**太字** と *斜体* と ~~取り消し線~~\n文中の `コード` は等幅の文字になります。' },
        { h: '箇条書き', note: '行の先頭に - (または * か +)と空白を書きます。空白2つで字下げすると、入れ子になります。',
          src: '- りんご\n- みかん\n  - 温州みかん\n  - 伊予柑\n- ぶどう' },
        { h: '番号付きの箇条書き', note: '数字のあとに . か ) を書きます。',
          src: '1. 準備する\n2. 実行する\n3. 確かめる' },
        { h: 'チェックボックス', note: '箇条書きのあとに [ ](未完了)か [x](完了)を書きます。',
          src: '- [x] 牛乳を買う\n- [ ] 手紙を出す' },
        { h: 'リンク', note: '[表示する文字](アドレス) と書きます。',
          src: '[Electron のサイト](https://www.electronjs.org/)' },
        { h: '引用', note: '行の先頭に > を書きます。',
          src: '> 引用した文章です。\n> 2行目も続きます。' },
        { h: 'コードのかたまり', note: F + ' だけの行で前後を囲みます。中の文字は書いたとおりに表示されます。',
          src: F + '\nfunction hello() {\n  return "こんにちは";\n}\n' + F },
        { h: '区切り線', note: '- か * か _ を3つ以上並べた行です。',
          src: '上の文章\n\n---\n\n下の文章' },
        { h: '表', note: '1行目が見出し、2行目が区切りです。区切りの :--- は左寄せ、:---: は中央、---: は右寄せです。セルの中に | を書くときは \\| にします。',
          src: '| 品目 | 産地 | 数量 |\n|:---|:---:|---:|\n| りんご | 青森 | 6 |\n| みかん | 愛媛 | 12 |' },
        { h: '画像・ファイルの添付', note: '画像を貼り付けるか、ファイルをドラッグ&ドロップするか、「添付」ボタンで選ぶと、カーソルの位置に次のように書かれます。! で始まるものは画像、ないものはファイルへのリンクです。「名前」の部分は自由に書き換えられます(| [ ] は使えません)。添付の書き方を別のメモにコピーしても表示されないので、ファイルを貼り付け直してください。',
          src: '![スクリーンショット](attach:0123456789abcdef.png)\n[見積書](attach:fedcba9876543210.pdf)', noRender: true }
      ]
    },
    en: {
      title: 'Markdown Guide',
      intro: 'This is the Markdown you can use in EverPad. The left side shows what you type; the right side shows how it looks in the preview.',
      diffTitle: 'Differences from other Markdown',
      diffs: [
        'A line break inside a paragraph is shown as a line break (no need for two trailing spaces).',
        'Only images attached to EverPad are shown as images. Images on the web are not displayed.',
        'Only addresses that start with http:// or https:// become links. Clicking a link opens it in your default browser.',
        'HTML tags are shown as plain text.'
      ],
      src: 'You type', out: 'You see',
      sections: [
        { h: 'Headings', note: 'Start the line with # followed by a space. The number of # (1 to 6) sets the size. The first line becomes the note title in the note list.',
          src: '# Heading 1\n## Heading 2\n### Heading 3' },
        { h: 'Paragraphs and line breaks', note: 'A line break is kept as a line break. An empty line starts a new paragraph.',
          src: 'First line\nSecond line\n\nAfter an empty line, a new paragraph starts.' },
        { h: 'Emphasis', note: '',
          src: '**bold**, *italic* and ~~strikethrough~~\n`code` inside text is shown in a monospace font.' },
        { h: 'Bulleted lists', note: 'Start the line with - (or * or +) and a space. Indent by two spaces to nest.',
          src: '- Apples\n- Oranges\n  - Navel\n  - Valencia\n- Grapes' },
        { h: 'Numbered lists', note: 'Write a number followed by . or ).',
          src: '1. Prepare\n2. Run\n3. Check' },
        { h: 'Check boxes', note: 'Add [ ] (not done) or [x] (done) after the bullet.',
          src: '- [x] Buy milk\n- [ ] Post the letter' },
        { h: 'Links', note: 'Write [text to show](address).',
          src: '[Electron website](https://www.electronjs.org/)' },
        { h: 'Block quotes', note: 'Start the line with >.',
          src: '> This is a quotation.\n> The second line continues it.' },
        { h: 'Code blocks', note: 'Surround the code with lines containing only ' + F + '. The text inside is shown exactly as typed.',
          src: F + '\nfunction hello() {\n  return "Hello";\n}\n' + F },
        { h: 'Horizontal rules', note: 'A line of three or more -, * or _.',
          src: 'Text above\n\n---\n\nText below' },
        { h: 'Tables', note: 'The first row is the header and the second row is the separator. In the separator, :--- aligns left, :---: centers and ---: aligns right. To put | in a cell, write \\|.',
          src: '| Item | Origin | Qty |\n|:---|:---:|---:|\n| Apples | Aomori | 6 |\n| Oranges | Ehime | 12 |' },
        { h: 'Images and attachments', note: 'Paste an image, drag and drop a file, or choose one with the Attach button, and text like the following is inserted at the cursor. Lines starting with ! are images; the others are links to files. You may change the "name" part freely (do not use |, [ or ]). Copying this syntax into another note does not work; paste the file again instead.',
          src: '![Screenshot](attach:0123456789abcdef.png)\n[Quote](attach:fedcba9876543210.pdf)', noRender: true }
      ]
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = HELP;
  else root.EVERPAD_HELP = HELP;
})(typeof window !== 'undefined' ? window : this);
