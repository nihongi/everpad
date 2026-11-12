'use strict';
/* 図エディタの「ひな型」(Mermaid の典型的な図)。ja / en はボタンの名前、src は言語ごとの見本の文(図の中の言葉だけ違う)。
   どれも Mermaid の書き方の説明(mermaid.js.org)にある基本の形で、選んでから書き換えて使う */
(function () {
  const T = [
    {
      id: 'flowchart', ja: 'フローチャート', en: 'Flowchart',
      src: {
        ja: 'flowchart TD\n    A[開始] --> B{条件を満たす?}\n    B -->|はい| C[処理 1]\n    B -->|いいえ| D[処理 2]\n    C --> E[終了]\n    D --> E',
        en: 'flowchart TD\n    A[Start] --> B{Condition met?}\n    B -->|Yes| C[Step 1]\n    B -->|No| D[Step 2]\n    C --> E[End]\n    D --> E'
      }
    },
    {
      id: 'flowchartLR', ja: 'フローチャート(横)', en: 'Flowchart (left to right)',
      src: {
        ja: 'flowchart LR\n    A[書く] --> B{見直す}\n    B -->|直す| A\n    B -->|よい| C[公開する]',
        en: 'flowchart LR\n    A[Write] --> B{Review}\n    B -->|Revise| A\n    B -->|OK| C[Publish]'
      }
    },
    {
      id: 'sequence', ja: 'シーケンス図', en: 'Sequence diagram',
      src: {
        ja: 'sequenceDiagram\n    participant U as 利用者\n    participant A as アプリ\n    participant S as サーバー\n    U->>A: ボタンを押す\n    A->>S: 要求\n    S-->>A: 応答\n    A-->>U: 結果を表示',
        en: 'sequenceDiagram\n    participant U as User\n    participant A as App\n    participant S as Server\n    U->>A: Press the button\n    A->>S: Request\n    S-->>A: Response\n    A-->>U: Show the result'
      }
    },
    {
      id: 'class', ja: 'クラス図', en: 'Class diagram',
      src: {
        ja: 'classDiagram\n    class Animal["動物"] {\n        +name\n        +speak()\n    }\n    class Dog["犬"]\n    class Cat["猫"]\n    Animal <|-- Dog\n    Animal <|-- Cat',
        en: 'classDiagram\n    class Animal {\n        +name\n        +speak()\n    }\n    class Dog\n    class Cat\n    Animal <|-- Dog\n    Animal <|-- Cat'
      }
    },
    {
      id: 'state', ja: '状態遷移図', en: 'State diagram',
      src: {
        ja: 'stateDiagram-v2\n    state "待機" as Idle\n    state "処理中" as Busy\n    state "完了" as Done\n    [*] --> Idle\n    Idle --> Busy : 開始\n    Busy --> Done : 成功\n    Busy --> Idle : 失敗\n    Done --> [*]',
        en: 'stateDiagram-v2\n    [*] --> Idle\n    Idle --> Busy : Start\n    Busy --> Done : Success\n    Busy --> Idle : Failure\n    Done --> [*]'
      }
    },
    {
      id: 'er', ja: 'ER 図', en: 'Entity relationship',
      src: {
        ja: 'erDiagram\n    CUSTOMER["顧客"] {\n        string name\n        string email\n    }\n    ORDER["注文"] {\n        int id\n        date ordered\n    }\n    ITEM["明細"]\n    CUSTOMER ||--o{ ORDER : "する"\n    ORDER ||--|{ ITEM : "含む"',
        en: 'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE_ITEM : contains\n    CUSTOMER {\n        string name\n        string email\n    }\n    ORDER {\n        int id\n        date ordered\n    }'
      }
    },
    {
      id: 'gantt', ja: 'ガントチャート', en: 'Gantt chart',
      src: {
        ja: 'gantt\n    title 計画\n    dateFormat YYYY-MM-DD\n    section 準備\n    調査 :a1, 2026-01-05, 5d\n    設計 :a2, after a1, 7d\n    section 作業\n    作る :b1, after a2, 10d\n    確かめる :b2, after b1, 5d',
        en: 'gantt\n    title Plan\n    dateFormat YYYY-MM-DD\n    section Preparation\n    Research :a1, 2026-01-05, 5d\n    Design :a2, after a1, 7d\n    section Work\n    Build :b1, after a2, 10d\n    Test :b2, after b1, 5d'
      }
    },
    {
      id: 'pie', ja: '円グラフ', en: 'Pie chart',
      src: {
        ja: 'pie title 内訳\n    "A" : 45\n    "B" : 30\n    "C" : 25',
        en: 'pie title Breakdown\n    "A" : 45\n    "B" : 30\n    "C" : 25'
      }
    },
    {
      id: 'mindmap', ja: 'マインドマップ', en: 'Mind map',
      src: {
        ja: 'mindmap\n    root((テーマ))\n        アイデア 1\n            詳しく\n            例\n        アイデア 2\n        アイデア 3',
        en: 'mindmap\n    root((Topic))\n        Idea 1\n            Details\n            Example\n        Idea 2\n        Idea 3'
      }
    },
    {
      id: 'timeline', ja: '年表', en: 'Timeline',
      src: {
        ja: 'timeline\n    title あゆみ\n    2024 : 計画\n    2025 : 試作 : 開発\n    2026 : 公開',
        en: 'timeline\n    title History\n    2024 : Planning\n    2025 : Prototype : Development\n    2026 : Release'
      }
    },
    {
      id: 'git', ja: 'Git のグラフ', en: 'Git graph',
      src: {
        ja: 'gitGraph\n    commit\n    branch feature\n    checkout feature\n    commit\n    commit\n    checkout main\n    merge feature\n    commit',
        en: 'gitGraph\n    commit\n    branch feature\n    checkout feature\n    commit\n    commit\n    checkout main\n    merge feature\n    commit'
      }
    },
    {
      id: 'quadrant', ja: '4象限のチャート', en: 'Quadrant chart',
      src: {
        ja: 'quadrantChart\n    title 優先度\n    x-axis 手間が小さい --> 手間が大きい\n    y-axis 効果が小さい --> 効果が大きい\n    quadrant-1 計画して行う\n    quadrant-2 すぐ行う\n    quadrant-3 後回し\n    quadrant-4 やめる\n    A: [0.3, 0.8]\n    B: [0.7, 0.6]\n    C: [0.2, 0.3]',
        en: 'quadrantChart\n    title Priorities\n    x-axis Low effort --> High effort\n    y-axis Low impact --> High impact\n    quadrant-1 Plan it\n    quadrant-2 Do it now\n    quadrant-3 Later\n    quadrant-4 Drop it\n    A: [0.3, 0.8]\n    B: [0.7, 0.6]\n    C: [0.2, 0.3]'
      }
    }
  ];
  if (typeof window !== 'undefined') window.DIAGRAM_TEMPLATES = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})();
