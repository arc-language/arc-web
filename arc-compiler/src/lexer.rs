/// Arc lexer - ported from src/lexer.js

#[derive(Debug, Clone, PartialEq)]
pub enum TokenType {
    // Literals
    STRING,
    NUMBER,
    BOOL,
    NONE,
    // Identifiers
    IDENT,
    AT_IDENT,
    // Structure keywords
    PAGE,
    WIDGET,
    DESIGN,
    IMPORT,
    EXPORT,
    FROM,
    // Logic keywords
    CONST,
    LET,
    FN,
    CLASS,
    RETURN,
    IF,
    ELSE,
    UNLESS,
    MATCH,
    FOR,
    IN,
    WHILE,
    UNTIL,
    LOOP,
    BREAK,
    CONTINUE,
    AWAIT,
    ASYNC,
    GEN,
    YIELD,
    TRY,
    CATCH,
    THROW,
    NEW,
    STATIC,
    GET,
    IS,
    RAW,
    // Result types
    OK,
    ERR,
    // Backend keywords
    MODEL,
    JOB,
    // Symbols
    LPAREN,
    RPAREN,
    LBRACE,
    RBRACE,
    LBRACKET,
    RBRACKET,
    DOT,
    DOTDOT,
    DOTDOTEQ,
    COMMA,
    COLON,
    SEMI,
    ARROW,
    THIN_ARROW,
    PIPE,
    QUESTION,
    QQDOT,
    QQ,
    HASH,
    SPREAD,
    // Operators
    PLUS,
    MINUS,
    STAR,
    SLASH,
    PERCENT,
    STARSTAR,
    EQ,
    EQEQ,
    BANGEQ,
    LT,
    GT,
    LTEQ,
    GTEQ,
    BANG,
    AMP,
    AMPAMP,
    BAR,
    BARBAR,
    PLUS_EQ,
    MINUS_EQ,
    STAR_EQ,
    SLASH_EQ,
    // Template-specific
    INDENT,
    DEDENT,
    NEWLINE,
    // Interpolation
    INTERP_START,
    INTERP_END,
    EOF,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TokenValue {
    None,
    Str(String),
    Num(f64),
    Bool(bool),
}

#[derive(Debug, Clone)]
pub struct Token {
    pub kind: TokenType,
    pub value: TokenValue,
    pub line: usize,
    pub col: usize,
}

impl Token {
    pub fn new(kind: TokenType, value: TokenValue, line: usize, col: usize) -> Self {
        Token { kind, value, line, col }
    }

    pub fn str_val(&self) -> &str {
        match &self.value {
            TokenValue::Str(s) => s.as_str(),
            _ => "",
        }
    }

    pub fn num_val(&self) -> f64 {
        match &self.value {
            TokenValue::Num(n) => *n,
            _ => 0.0,
        }
    }
}

fn keyword(s: &str) -> Option<TokenType> {
    match s {
        "page" => Some(TokenType::PAGE),
        "widget" => Some(TokenType::WIDGET),
        "design" => Some(TokenType::DESIGN),
        "import" => Some(TokenType::IMPORT),
        "export" => Some(TokenType::EXPORT),
        "from" => Some(TokenType::FROM),
        "const" => Some(TokenType::CONST),
        "let" => Some(TokenType::LET),
        "fn" => Some(TokenType::FN),
        "class" => Some(TokenType::CLASS),
        "return" => Some(TokenType::RETURN),
        "if" => Some(TokenType::IF),
        "else" => Some(TokenType::ELSE),
        "unless" => Some(TokenType::UNLESS),
        "match" => Some(TokenType::MATCH),
        "for" => Some(TokenType::FOR),
        "in" => Some(TokenType::IN),
        "while" => Some(TokenType::WHILE),
        "until" => Some(TokenType::UNTIL),
        "loop" => Some(TokenType::LOOP),
        "break" => Some(TokenType::BREAK),
        "continue" => Some(TokenType::CONTINUE),
        "await" => Some(TokenType::AWAIT),
        "async" => Some(TokenType::ASYNC),
        "gen" => Some(TokenType::GEN),
        "yield" => Some(TokenType::YIELD),
        "try" => Some(TokenType::TRY),
        "catch" => Some(TokenType::CATCH),
        "throw" => Some(TokenType::THROW),
        "new" => Some(TokenType::NEW),
        "static" => Some(TokenType::STATIC),
        "get" => Some(TokenType::GET),
        "is" => Some(TokenType::IS),
        "raw" => Some(TokenType::RAW),
        "true" => Some(TokenType::BOOL),
        "false" => Some(TokenType::BOOL),
        "none" => Some(TokenType::NONE),
        "Ok" => Some(TokenType::OK),
        "Err" => Some(TokenType::ERR),
        "model" => Some(TokenType::MODEL),
        "job" => Some(TokenType::JOB),
        _ => None,
    }
}

struct Lexer {
    source: Vec<char>,
    filename: String,
    pos: usize,
    line: usize,
    col: usize,
    tokens: Vec<Token>,
    indent_stack: Vec<usize>,
}

impl Lexer {
    fn new(source: &str, filename: &str) -> Self {
        Lexer {
            source: source.chars().collect(),
            filename: filename.to_string(),
            pos: 0,
            line: 1,
            col: 1,
            tokens: Vec::new(),
            indent_stack: vec![0],
        }
    }

    fn peek(&self, offset: usize) -> Option<char> {
        self.source.get(self.pos + offset).copied()
    }

    fn advance(&mut self) -> Option<char> {
        let ch = self.source.get(self.pos).copied()?;
        self.pos += 1;
        if ch == '\n' {
            self.line += 1;
            self.col = 1;
        } else {
            self.col += 1;
        }
        Some(ch)
    }

    fn match_char(&mut self, expected: char) -> bool {
        if self.source.get(self.pos) == Some(&expected) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn emit(&mut self, kind: TokenType, value: TokenValue, line: usize, col: usize) {
        self.tokens.push(Token::new(kind, value, line, col));
    }

    fn emit_at_current(&mut self, kind: TokenType, value: TokenValue) {
        let line = self.line;
        let col = self.col.saturating_sub(1);
        self.tokens.push(Token::new(kind, value, line, col));
    }

    fn skip_inline_whitespace(&mut self) {
        while self.pos < self.source.len() {
            match self.source[self.pos] {
                ' ' | '\t' => { self.advance(); }
                _ => break,
            }
        }
    }

    fn skip_line_comment(&mut self) {
        while self.pos < self.source.len() && self.source[self.pos] != '\n' {
            self.advance();
        }
    }

    fn measure_indent(&mut self) -> usize {
        let mut indent = 0;
        while self.pos < self.source.len() {
            match self.source[self.pos] {
                ' ' => { indent += 1; self.advance(); }
                '\t' => { indent += 2; self.advance(); }
                _ => break,
            }
        }
        indent
    }

    fn tokenize_string(&mut self, quote: char) {
        let line = self.line;
        let col = self.col.saturating_sub(1);
        let mut value = String::new();

        while self.pos < self.source.len() {
            let ch = self.source[self.pos];

            if ch == '\\' {
                self.advance();
                if let Some(esc) = self.advance() {
                    let escaped = match esc {
                        'n' => '\n',
                        't' => '\t',
                        'r' => '\r',
                        '\\' => '\\',
                        '"' => '"',
                        '\'' => '\'',
                        '{' => '{',
                        _ => esc,
                    };
                    value.push(escaped);
                }
                continue;
            }

            if quote == '"' && ch == '{' {
                // Start interpolation
                self.emit(TokenType::STRING, TokenValue::Str(value.clone()), line, col);
                value.clear();
                self.advance(); // consume {
                let interp_line = self.line;
                let interp_col = self.col.saturating_sub(1);
                self.emit(TokenType::INTERP_START, TokenValue::Str("{".to_string()), interp_line, interp_col);
                self.tokenize_interpolation();
                let end_line = self.line;
                let end_col = self.col.saturating_sub(1);
                self.emit(TokenType::INTERP_END, TokenValue::Str("}".to_string()), end_line, end_col);
                continue;
            }

            if ch == quote {
                self.advance();
                break;
            }

            if ch == '\n' && quote != '`' {
                // unterminated - break gracefully
                break;
            }

            value.push(ch);
            self.advance();
        }

        self.emit(TokenType::STRING, TokenValue::Str(value), line, col);
    }

    fn tokenize_interpolation(&mut self) {
        let mut depth = 0usize;
        while self.pos < self.source.len() {
            let ch = self.source[self.pos];
            if ch == '{' {
                depth += 1;
                self.tokenize_one();
            } else if ch == '}' {
                if depth == 0 {
                    self.advance();
                    return;
                }
                depth -= 1;
                self.tokenize_one();
            } else {
                self.tokenize_one();
            }
        }
    }

    fn tokenize_number(&mut self) {
        let start = self.pos - 1;
        while self.pos < self.source.len() {
            match self.source[self.pos] {
                '0'..='9' | '_' => { self.advance(); }
                _ => break,
            }
        }
        if self.pos < self.source.len() && self.source[self.pos] == '.' {
            if let Some(next) = self.source.get(self.pos + 1) {
                if next.is_ascii_digit() {
                    self.advance(); // consume .
                    while self.pos < self.source.len() {
                        match self.source[self.pos] {
                            '0'..='9' | '_' => { self.advance(); }
                            _ => break,
                        }
                    }
                }
            }
        }
        let raw: String = self.source[start..self.pos].iter().filter(|&&c| c != '_').collect();
        let num: f64 = raw.parse().unwrap_or(0.0);
        let line = self.line;
        let col = self.col.saturating_sub(self.pos - start);
        self.emit(TokenType::NUMBER, TokenValue::Num(num), line, col);
    }

    fn tokenize_ident(&mut self, first: char) {
        let start = self.pos - 1;
        while self.pos < self.source.len() {
            match self.source[self.pos] {
                'a'..='z' | 'A'..='Z' | '0'..='9' | '_' | '$' => { self.advance(); }
                _ => break,
            }
        }
        let value: String = self.source[start..self.pos].iter().collect();
        let line = self.line;
        let col = self.col.saturating_sub(self.pos - start);
        if let Some(kw) = keyword(&value) {
            let tv = match kw {
                TokenType::BOOL => {
                    if value == "true" { TokenValue::Bool(true) } else { TokenValue::Bool(false) }
                }
                _ => TokenValue::Str(value.clone()),
            };
            self.emit(kw, tv, line, col);
        } else {
            self.emit(TokenType::IDENT, TokenValue::Str(value), line, col);
        }
    }

    fn tokenize_at_sign(&mut self) {
        let start = self.pos - 1;
        while self.pos < self.source.len() {
            match self.source[self.pos] {
                'a'..='z' | 'A'..='Z' | '0'..='9' | '_' => { self.advance(); }
                _ => break,
            }
        }
        let value: String = self.source[start..self.pos].iter().collect();
        let line = self.line;
        let col = self.col.saturating_sub(self.pos - start);
        self.emit(TokenType::AT_IDENT, TokenValue::Str(value), line, col);
    }

    fn tokenize_one(&mut self) -> bool {
        self.skip_inline_whitespace();
        if self.pos >= self.source.len() {
            self.emit_at_current(TokenType::EOF, TokenValue::None);
            return false;
        }

        let ch = match self.advance() {
            Some(c) => c,
            None => return false,
        };
        let line = self.line;
        let col = self.col.saturating_sub(1);

        if ch == '\n' {
            self.emit(TokenType::NEWLINE, TokenValue::Str("\n".to_string()), line, col);
            return true;
        }

        if ch == '/' && self.peek(0) == Some('/') {
            self.skip_line_comment();
            return true;
        }

        if ch == '"' || ch == '\'' {
            self.tokenize_string(ch);
            return true;
        }

        if ch.is_ascii_digit() {
            self.tokenize_number();
            return true;
        }

        if ch.is_alphabetic() || ch == '_' || ch == '$' {
            self.tokenize_ident(ch);
            return true;
        }

        if ch == '@' {
            self.tokenize_at_sign();
            return true;
        }

        match ch {
            '.' => {
                if self.peek(0) == Some('.') && self.peek(1) == Some('.') {
                    self.advance(); self.advance();
                    self.emit(TokenType::SPREAD, TokenValue::Str("...".to_string()), line, col);
                } else if self.peek(0) == Some('.') && self.peek(1) == Some('=') {
                    self.advance(); self.advance();
                    self.emit(TokenType::DOTDOTEQ, TokenValue::Str("..=".to_string()), line, col);
                } else if self.peek(0) == Some('.') {
                    self.advance();
                    self.emit(TokenType::DOTDOT, TokenValue::Str("..".to_string()), line, col);
                } else {
                    self.emit(TokenType::DOT, TokenValue::Str(".".to_string()), line, col);
                }
            }
            '=' => {
                if self.match_char('=') {
                    self.emit(TokenType::EQEQ, TokenValue::Str("==".to_string()), line, col);
                } else if self.match_char('>') {
                    self.emit(TokenType::ARROW, TokenValue::Str("=>".to_string()), line, col);
                } else {
                    self.emit(TokenType::EQ, TokenValue::Str("=".to_string()), line, col);
                }
            }
            '!' => {
                if self.match_char('=') {
                    self.emit(TokenType::BANGEQ, TokenValue::Str("!=".to_string()), line, col);
                } else {
                    self.emit(TokenType::BANG, TokenValue::Str("!".to_string()), line, col);
                }
            }
            '<' => {
                if self.match_char('=') {
                    self.emit(TokenType::LTEQ, TokenValue::Str("<=".to_string()), line, col);
                } else {
                    self.emit(TokenType::LT, TokenValue::Str("<".to_string()), line, col);
                }
            }
            '>' => {
                if self.match_char('=') {
                    self.emit(TokenType::GTEQ, TokenValue::Str(">=".to_string()), line, col);
                } else {
                    self.emit(TokenType::GT, TokenValue::Str(">".to_string()), line, col);
                }
            }
            '&' => {
                if self.match_char('&') {
                    self.emit(TokenType::AMPAMP, TokenValue::Str("&&".to_string()), line, col);
                } else {
                    self.emit(TokenType::AMP, TokenValue::Str("&".to_string()), line, col);
                }
            }
            '|' => {
                if self.match_char('>') {
                    self.emit(TokenType::PIPE, TokenValue::Str("|>".to_string()), line, col);
                } else if self.match_char('|') {
                    self.emit(TokenType::BARBAR, TokenValue::Str("||".to_string()), line, col);
                } else {
                    self.emit(TokenType::BAR, TokenValue::Str("|".to_string()), line, col);
                }
            }
            '?' => {
                if self.match_char('.') {
                    self.emit(TokenType::QQDOT, TokenValue::Str("?.".to_string()), line, col);
                } else if self.match_char('?') {
                    self.emit(TokenType::QQ, TokenValue::Str("??".to_string()), line, col);
                } else {
                    self.emit(TokenType::QUESTION, TokenValue::Str("?".to_string()), line, col);
                }
            }
            '+' => {
                if self.match_char('=') {
                    self.emit(TokenType::PLUS_EQ, TokenValue::Str("+=".to_string()), line, col);
                } else {
                    self.emit(TokenType::PLUS, TokenValue::Str("+".to_string()), line, col);
                }
            }
            '-' => {
                if self.match_char('=') {
                    self.emit(TokenType::MINUS_EQ, TokenValue::Str("-=".to_string()), line, col);
                } else if self.match_char('>') {
                    self.emit(TokenType::THIN_ARROW, TokenValue::Str("->".to_string()), line, col);
                } else {
                    self.emit(TokenType::MINUS, TokenValue::Str("-".to_string()), line, col);
                }
            }
            '*' => {
                if self.match_char('*') {
                    self.emit(TokenType::STARSTAR, TokenValue::Str("**".to_string()), line, col);
                } else if self.match_char('=') {
                    self.emit(TokenType::STAR_EQ, TokenValue::Str("*=".to_string()), line, col);
                } else {
                    self.emit(TokenType::STAR, TokenValue::Str("*".to_string()), line, col);
                }
            }
            '/' => {
                if self.match_char('=') {
                    self.emit(TokenType::SLASH_EQ, TokenValue::Str("/=".to_string()), line, col);
                } else {
                    self.emit(TokenType::SLASH, TokenValue::Str("/".to_string()), line, col);
                }
            }
            '%' => self.emit(TokenType::PERCENT, TokenValue::Str("%".to_string()), line, col),
            '(' => self.emit(TokenType::LPAREN, TokenValue::Str("(".to_string()), line, col),
            ')' => self.emit(TokenType::RPAREN, TokenValue::Str(")".to_string()), line, col),
            '{' => self.emit(TokenType::LBRACE, TokenValue::Str("{".to_string()), line, col),
            '}' => self.emit(TokenType::RBRACE, TokenValue::Str("}".to_string()), line, col),
            '[' => self.emit(TokenType::LBRACKET, TokenValue::Str("[".to_string()), line, col),
            ']' => self.emit(TokenType::RBRACKET, TokenValue::Str("]".to_string()), line, col),
            ',' => self.emit(TokenType::COMMA, TokenValue::Str(",".to_string()), line, col),
            ':' => self.emit(TokenType::COLON, TokenValue::Str(":".to_string()), line, col),
            ';' => self.emit(TokenType::SEMI, TokenValue::Str(";".to_string()), line, col),
            '#' => self.emit(TokenType::HASH, TokenValue::Str("#".to_string()), line, col),
            _ => {} // skip unknown
        }
        true
    }

    fn tokenize(&mut self) -> Vec<Token> {
        while self.pos < self.source.len() {
            // Handle indentation at line start
            if self.col == 1 {
                // Skip blank lines
                if self.source[self.pos] == '\n' {
                    self.advance();
                    continue;
                }
                // Skip comment-only lines
                if self.pos + 1 < self.source.len() && self.source[self.pos] == '/' && self.source[self.pos + 1] == '/' {
                    self.skip_line_comment();
                    continue;
                }
                // Measure and emit INDENT/DEDENT tokens
                let indent = self.measure_indent();
                let current = *self.indent_stack.last().unwrap_or(&0);
                if indent > current {
                    self.indent_stack.push(indent);
                    let line = self.line;
                    let col = self.col;
                    self.emit(TokenType::INDENT, TokenValue::Num(indent as f64), line, col);
                } else if indent < current {
                    while self.indent_stack.len() > 1 && *self.indent_stack.last().unwrap_or(&0) > indent {
                        self.indent_stack.pop();
                        let line = self.line;
                        let col = self.col;
                        self.emit(TokenType::DEDENT, TokenValue::Num(indent as f64), line, col);
                    }
                }
            }
            self.tokenize_one();
        }

        // Close any remaining open indents
        while self.indent_stack.len() > 1 {
            self.indent_stack.pop();
            let line = self.line;
            let col = self.col;
            self.emit(TokenType::DEDENT, TokenValue::Num(0.0), line, col);
        }

        let line = self.line;
        let col = self.col;
        self.emit(TokenType::EOF, TokenValue::None, line, col);
        std::mem::take(&mut self.tokens)
    }
}

pub fn lex(source: &str, filename: &str) -> Vec<Token> {
    let mut lexer = Lexer::new(source, filename);
    lexer.tokenize()
}
