'use strict';
/* 数式エディタのパレット(タブごとの記号)とひな型(日本語と英語の名前)。app.js の数式エディタが画面に出し、テストでは require で読む。
   パレットの項目は LaTeX。{} は空の入れ物で、入れたときに最初の {} にカーソルを置き、Tab で次の {} に移る。
   ひな型は [日本語の名前, 英語の名前, LaTeX]。KaTeX(と mhchem)で表示でき、LaTeX の書き出しでもコンパイルできるものだけにする */
(function (root) {
  const TABS = [
    { id: 'tpl', ja: 'ひな型', en: 'Templates' },
    { id: 'ops', ja: '演算', en: 'Structures', items: [
      '\\frac{}{}', '\\dfrac{}{}', '\\sqrt{}', '\\sqrt[]{}', '^{}', '_{}', '_{}^{}', '\\binom{}{}',
      '\\sum_{}^{}', '\\prod_{}^{}', '\\int_{}^{}', '\\iint', '\\oint', '\\lim_{}', '\\log_{}{}', '\\ln{}',
      '\\left( {} \\right)', '\\left[ {} \\right]', '\\left\\{ {} \\right\\}', '\\left| {} \\right|', '\\left\\| {} \\right\\|', '\\lfloor {} \\rfloor', '\\lceil {} \\rceil', '\\langle {} \\rangle',
      '\\overline{}', '\\underline{}', '\\hat{}', '\\bar{}', '\\vec{}', '\\dot{}', '\\ddot{}', '\\tilde{}',
      '\\overbrace{}^{}', '\\underbrace{}_{}', '\\overrightarrow{}', '\\widehat{}',
      '\\begin{pmatrix} {} & {} \\\\ {} & {} \\end{pmatrix}', '\\begin{bmatrix} {} & {} \\\\ {} & {} \\end{bmatrix}', '\\begin{vmatrix} {} & {} \\\\ {} & {} \\end{vmatrix}',
      '\\begin{cases} {} & {} \\\\ {} & {} \\end{cases}', '\\begin{aligned} {} &= {} \\\\ &= {} \\end{aligned}',
      '+', '-', '\\pm', '\\mp', '\\times', '\\div', '\\cdot', '\\circ', '\\ast', '\\oplus', '\\otimes', '\\partial', '\\nabla', '\\infty'
    ] },
    { id: 'greek', ja: 'ギリシャ文字', en: 'Greek', items: [
      '\\alpha', '\\beta', '\\gamma', '\\delta', '\\epsilon', '\\varepsilon', '\\zeta', '\\eta', '\\theta', '\\vartheta', '\\iota', '\\kappa',
      '\\lambda', '\\mu', '\\nu', '\\xi', '\\pi', '\\varpi', '\\rho', '\\varrho', '\\sigma', '\\varsigma', '\\tau', '\\upsilon',
      '\\phi', '\\varphi', '\\chi', '\\psi', '\\omega',
      '\\Gamma', '\\Delta', '\\Theta', '\\Lambda', '\\Xi', '\\Pi', '\\Sigma', '\\Upsilon', '\\Phi', '\\Psi', '\\Omega'
    ] },
    { id: 'rel', ja: '関係・論理', en: 'Relations', items: [
      '=', '\\neq', '<', '>', '\\le', '\\ge', '\\leqq', '\\geqq', '\\ll', '\\gg', '\\approx', '\\simeq', '\\sim', '\\equiv', '\\cong', '\\propto',
      '\\in', '\\notin', '\\ni', '\\subset', '\\supset', '\\subseteq', '\\supseteq', '\\cap', '\\cup', '\\setminus', '\\emptyset',
      '\\forall', '\\exists', '\\nexists', '\\neg', '\\land', '\\lor', '\\therefore', '\\because', '\\perp', '\\parallel', '\\mid', '\\vdash', '\\models'
    ] },
    { id: 'arrow', ja: '矢印', en: 'Arrows', items: [
      '\\to', '\\leftarrow', '\\leftrightarrow', '\\Rightarrow', '\\Leftarrow', '\\Leftrightarrow', '\\longrightarrow', '\\longleftarrow', '\\Longrightarrow', '\\Longleftrightarrow',
      '\\mapsto', '\\uparrow', '\\downarrow', '\\updownarrow', '\\Uparrow', '\\Downarrow', '\\nearrow', '\\searrow', '\\swarrow', '\\nwarrow',
      '\\rightleftharpoons', '\\hookrightarrow', '\\xrightarrow{}', '\\xleftarrow{}', '\\iff', '\\implies'
    ] },
    { id: 'sym', ja: '記号', en: 'Symbols', items: [
      '\\infty', '\\partial', '\\nabla', '\\hbar', '\\ell', '\\Re', '\\Im', '\\aleph', '\\angle', '\\triangle', '^{\\circ}', '\\prime',
      '\\dagger', '\\star', '\\bullet', '\\cdots', '\\ldots', '\\vdots', '\\ddots', '\\square', '\\checkmark', '\\S',
      '\\mathbb{R}', '\\mathbb{N}', '\\mathbb{Z}', '\\mathbb{Q}', '\\mathbb{C}', '\\heartsuit', '\\spadesuit', '\\clubsuit', '\\diamondsuit'
    ] },
    { id: 'font', ja: '書体・色', en: 'Fonts and colors', items: [
      '\\mathbf{}', '\\mathit{}', '\\mathrm{}', '\\mathsf{}', '\\mathtt{}', '\\mathbb{}', '\\mathcal{}', '\\mathfrak{}', '\\mathscr{}', '\\boldsymbol{}',
      '\\text{}', '\\textbf{}', '\\boxed{}', '\\cancel{}',
      '\\color{red}{}', '\\color{blue}{}', '\\color{green}{}', '\\color{orange}{}', '\\color{purple}{}', '\\color{gray}{}',
      '\\displaystyle', '\\small', '\\large', '\\Large', '\\,', '\\;', '\\quad', '\\qquad'
    ] },
    { id: 'chem', ja: '化学', en: 'Chemistry', items: [
      '\\ce{}', '\\ce{H2O}', '\\ce{CO2}', '\\ce{A + B -> C}', '\\ce{A <=> B}', '\\ce{A <- B}', '\\ce{A ->[\\Delta] B}',
      '\\ce{Cu^{2+}}', '\\ce{SO4^{2-}}', '\\ce{e-}', '\\ce{H2O(l)}', '\\ce{NaCl(aq)}', '\\ce{CO2 ^}', '\\ce{AgCl v}',
      '\\pu{}', '\\pu{1.0 mol/L}', '\\pu{25 ^\\circ C}', '\\pu{100 kJ/mol}'
    ] }
  ];
  const TEMPLATES = [
    { ja: '基本', en: 'Basics', items: [
      ['分数', 'Fraction', '\\frac{a}{b}'],
      ['平方根', 'Square root', '\\sqrt{x}'],
      ['n 乗根', 'nth root', '\\sqrt[n]{x}'],
      ['添え字と累乗', 'Subscript and power', 'x_{i}^{2}'],
      ['絶対値', 'Absolute value', '\\left| x \\right|']
    ] },
    { ja: '代数', en: 'Algebra', items: [
      ['二次方程式の解', 'Quadratic formula', 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'],
      ['展開', 'Expansion', '(a + b)^2 = a^2 + 2ab + b^2'],
      ['連立方程式', 'Simultaneous equations', '\\begin{cases} a_1 x + b_1 y = c_1 \\\\ a_2 x + b_2 y = c_2 \\end{cases}'],
      ['式の変形', 'Step-by-step equation', '\\begin{aligned} f(x) &= (x + 1)^2 \\\\ &= x^2 + 2x + 1 \\end{aligned}'],
      ['対数', 'Logarithm', '\\log_{a} xy = \\log_{a} x + \\log_{a} y'],
      ['指数', 'Exponents', 'a^{m} a^{n} = a^{m + n}']
    ] },
    { ja: '解析', en: 'Calculus', items: [
      ['極限', 'Limit', '\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1'],
      ['微分', 'Derivative', '\\frac{d}{dx} f(x)'],
      ['導関数の定義', 'Definition of the derivative', "f'(x) = \\lim_{h \\to 0} \\frac{f(x + h) - f(x)}{h}"],
      ['偏微分', 'Partial derivative', '\\frac{\\partial f}{\\partial x}'],
      ['定積分', 'Definite integral', '\\int_{a}^{b} f(x)\\,dx'],
      ['不定積分', 'Indefinite integral', '\\int x^n\\,dx = \\frac{x^{n + 1}}{n + 1} + C'],
      ['重積分', 'Double integral', '\\iint_{D} f(x, y)\\,dx\\,dy'],
      ['総和', 'Sum', '\\sum_{k=1}^{n} k = \\frac{n(n + 1)}{2}'],
      ['総積', 'Product', '\\prod_{k=1}^{n} a_k'],
      ['テイラー展開', 'Taylor series', 'f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!} (x - a)^n']
    ] },
    { ja: '線形代数', en: 'Linear algebra', items: [
      ['行列(2×2)', 'Matrix (2×2)', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'],
      ['行列(3×3)', 'Matrix (3×3)', '\\begin{pmatrix} a_{11} & a_{12} & a_{13} \\\\ a_{21} & a_{22} & a_{23} \\\\ a_{31} & a_{32} & a_{33} \\end{pmatrix}'],
      ['行列式', 'Determinant', '\\det A = \\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix} = ad - bc'],
      ['逆行列', 'Inverse matrix', 'A^{-1} = \\frac{1}{ad - bc} \\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}'],
      ['ベクトル', 'Vector', '\\vec{a} = \\begin{pmatrix} a_1 \\\\ a_2 \\\\ a_3 \\end{pmatrix}'],
      ['内積', 'Dot product', '\\vec{a} \\cdot \\vec{b} = |\\vec{a}| |\\vec{b}| \\cos\\theta']
    ] },
    { ja: '確率・統計', en: 'Probability and statistics', items: [
      ['二項係数', 'Binomial coefficient', '\\binom{n}{k} = \\frac{n!}{k!(n - k)!}'],
      ['平均', 'Mean', '\\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i'],
      ['分散', 'Variance', '\\sigma^2 = \\frac{1}{n} \\sum_{i=1}^{n} (x_i - \\bar{x})^2'],
      ['正規分布', 'Normal distribution', 'f(x) = \\frac{1}{\\sqrt{2\\pi\\sigma^2}} \\exp\\left( -\\frac{(x - \\mu)^2}{2\\sigma^2} \\right)'],
      ['条件付き確率', 'Conditional probability', 'P(A \\mid B) = \\frac{P(A \\cap B)}{P(B)}'],
      ['期待値', 'Expected value', 'E[X] = \\sum_{i} x_i\\, p_i']
    ] },
    { ja: '三角関数', en: 'Trigonometry', items: [
      ['基本の関係', 'Pythagorean identity', '\\sin^2\\theta + \\cos^2\\theta = 1'],
      ['加法定理', 'Angle addition', '\\sin(\\alpha + \\beta) = \\sin\\alpha\\cos\\beta + \\cos\\alpha\\sin\\beta'],
      ['オイラーの公式', "Euler's formula", 'e^{i\\theta} = \\cos\\theta + i\\sin\\theta']
    ] },
    { ja: '集合・論理', en: 'Sets and logic', items: [
      ['集合', 'Set-builder notation', 'A = \\{\\, x \\mid x > 0 \\,\\}'],
      ['場合分け', 'Cases', 'f(x) = \\begin{cases} x & (x \\ge 0) \\\\ -x & (x < 0) \\end{cases}'],
      ['任意と存在', 'For all, there exists', '\\forall \\varepsilon > 0,\\ \\exists \\delta > 0']
    ] },
    { ja: '物理', en: 'Physics', items: [
      ['運動方程式', "Newton's second law", '\\vec{F} = m\\vec{a}'],
      ['質量とエネルギー', 'Mass–energy', 'E = mc^2']
    ] },
    { ja: '化学', en: 'Chemistry', items: [
      ['化学反応式', 'Chemical equation', '\\ce{2H2 + O2 -> 2H2O}'],
      ['化学平衡', 'Equilibrium', '\\ce{N2 + 3H2 <=> 2NH3}'],
      ['イオン', 'Ions', '\\ce{Cu^{2+} + 2e- -> Cu}'],
      ['単位', 'Units', '\\pu{9.8 m/s^2}']
    ] }
  ];
  /* パレットのボタンに描く形: 空の {} は □、^ や _ で始まるものは □ を土台にする(\text{} などの文字の中は文字の □) */
  const show = s => (/^[\^_]/.test(s) ? '\\square' : '') + s.replace(/(\\text(?:bf)?)\{\}/g, '$1{□}').replace(/\{\}/g, '{\\square}');
  const MATH_PALETTE = { tabs: TABS, templates: TEMPLATES, show: show };
  if (typeof module !== 'undefined' && module.exports) module.exports = MATH_PALETTE;
  else root.MATH_PALETTE = MATH_PALETTE;
})(typeof window !== 'undefined' ? window : this);
