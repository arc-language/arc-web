use serde_json::{json, Value, Map};
use crate::lexer::{Token, TokenType, TokenValue};

macro_rules! node {
    ($type:expr, $line:expr $(, $key:expr => $val:expr)*) => {{
        let mut m = Map::new();
        m.insert("type".into(), json!($type));
        m.insert("line".into(), json!($line));
        $(m.insert($key.into(), $val);)*
        Value::Object(m)
    }};
}

fn is_ws(t: &TokenType) -> bool {
    matches!(t, TokenType::NEWLINE | TokenType::INDENT | TokenType::DEDENT)
}

struct Parser {
    tokens: Vec<Token>,
    pos: usize,
    nws_tokens: Vec<Token>,
    nws_at: Vec<usize>,
    nws_raw_pos: Vec<usize>,
    hoisted_decls: Vec<Value>,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Self {
        let nws_tokens: Vec<Token> = tokens.iter()
            .filter(|t| !is_ws(&t.kind))
            .cloned()
            .collect();

        let mut nws_at = vec![0usize; tokens.len() + 1];
        let mut nws_raw_pos = vec![0usize; nws_tokens.len()];
        let mut nws_idx = 0usize;
        for (i, t) in tokens.iter().enumerate() {
            nws_at[i] = nws_idx;
            if !is_ws(&t.kind) {
                nws_raw_pos[nws_idx] = i;
                nws_idx += 1;
            }
        }
        nws_at[tokens.len()] = nws_idx;

        Parser { tokens, pos: 0, nws_tokens, nws_at, nws_raw_pos, hoisted_decls: vec![] }
    }

    fn peek(&self, offset: usize) -> &Token {
        let idx = self.nws_at[self.pos.min(self.tokens.len())] + offset;
        if idx < self.nws_tokens.len() {
            &self.nws_tokens[idx]
        } else {
            self.nws_tokens.last().unwrap_or(&self.tokens[self.tokens.len() - 1])
        }
    }

    fn peek_kind(&self, offset: usize) -> &TokenType {
        &self.peek(offset).kind
    }

    fn current(&self) -> &Token {
        let idx = self.pos.min(self.tokens.len() - 1);
        &self.tokens[idx]
    }

    fn advance(&mut self) -> &Token {
        let idx = self.pos;
        if self.pos < self.tokens.len() - 1 { self.pos += 1; }
        &self.tokens[idx]
    }

    fn skip_whitespace(&mut self) {
        while self.pos < self.tokens.len() && is_ws(&self.tokens[self.pos].kind) {
            self.pos += 1;
        }
    }

    fn consume_newlines(&mut self) {
        while self.pos < self.tokens.len() && self.tokens[self.pos].kind == TokenType::NEWLINE {
            self.pos += 1;
        }
    }

    fn check(&self, kind: &TokenType) -> bool {
        &self.peek(0).kind == kind
    }

    fn match_tok(&mut self, kinds: &[TokenType]) -> Option<Token> {
        let nws_idx = self.nws_at[self.pos.min(self.tokens.len())];
        if nws_idx >= self.nws_tokens.len() { return None; }
        let tok = &self.nws_tokens[nws_idx];
        if kinds.iter().any(|k| k == &tok.kind) {
            let result = tok.clone();
            self.pos = self.nws_raw_pos[nws_idx] + 1;
            Some(result)
        } else {
            None
        }
    }

    fn eat(&mut self, kind: TokenType) -> Token {
        self.skip_whitespace();
        let t = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
        if t.kind == kind {
            if self.pos < self.tokens.len() - 1 { self.pos += 1; }
            t
        } else {
            // Error recovery: return a dummy token
            eprintln!("Expected {:?}, got {:?} at line {}", kind, t.kind, t.line);
            Token::new(kind, TokenValue::None, t.line, t.col)
        }
    }

    fn eat_if(&mut self, kind: TokenType) -> Option<Token> {
        if !is_ws(&kind) {
            self.skip_whitespace();
        }
        let t = self.tokens.get(self.pos)?;
        if t.kind == kind {
            let result = t.clone();
            self.pos += 1;
            Some(result)
        } else {
            None
        }
    }

    fn next_tok(&mut self) -> Token {
        self.skip_whitespace();
        let t = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
        if self.pos < self.tokens.len() - 1 { self.pos += 1; }
        t
    }

    // ── Parse ──────────────────────────────────────────────────────────────────

    pub fn parse(&mut self) -> Value {
        let mut declarations = vec![];
        loop {
            self.skip_whitespace();
            if self.tokens[self.pos.min(self.tokens.len()-1)].kind == TokenType::EOF { break; }
            let before = self.pos;
            if let Some(decl) = self.parse_top_level() {
                declarations.push(decl);
            }
            if self.pos == before { self.pos += 1; }
        }
        let mut hoisted = std::mem::take(&mut self.hoisted_decls);
        hoisted.extend(declarations);
        node!("Program", 1, "imports" => json!([]), "declarations" => json!(hoisted))
    }

    fn parse_top_level(&mut self) -> Option<Value> {
        self.skip_whitespace();
        let t = self.tokens.get(self.pos)?;
        if t.kind == TokenType::EOF { return None; }

        match &t.kind {
            TokenType::AT_IDENT => Some(self.parse_annotated_decl()),
            TokenType::IMPORT => Some(self.parse_import()),
            TokenType::EXPORT => Some(self.parse_export()),
            TokenType::WIDGET => Some(self.parse_widget()),
            TokenType::PAGE => Some(self.parse_page()),
            TokenType::DESIGN => Some(self.parse_design()),
            TokenType::CONST | TokenType::LET => Some(self.parse_var_decl()),
            TokenType::FN => Some(self.parse_fn_decl()),
            TokenType::CLASS => Some(self.parse_class_decl()),
            TokenType::MODEL => Some(self.parse_model_decl()),
            TokenType::JOB => Some(self.parse_job_decl()),
            _ => Some(self.parse_expr_statement()),
        }
    }

    // ── Import ─────────────────────────────────────────────────────────────────

    fn parse_import(&mut self) -> Value {
        let tok = self.eat(TokenType::IMPORT);
        let mut default_name = Value::Null;
        let mut names = vec![];

        if self.peek_kind(0) == &TokenType::IDENT {
            default_name = json!(self.eat(TokenType::IDENT).str_val().to_string());
            self.eat_if(TokenType::COMMA);
        }

        if self.check(&TokenType::LBRACE) {
            self.eat(TokenType::LBRACE);
            while self.peek_kind(0) != &TokenType::RBRACE && self.peek_kind(0) != &TokenType::EOF {
                let imported = self.eat(TokenType::IDENT).str_val().to_string();
                let local = if self.peek_kind(0) == &TokenType::IDENT && self.peek(0).str_val() == "as" {
                    self.next_tok();
                    self.eat(TokenType::IDENT).str_val().to_string()
                } else {
                    imported.clone()
                };
                names.push(json!({ "imported": imported, "local": local }));
                self.eat_if(TokenType::COMMA);
            }
            self.eat(TokenType::RBRACE);
        }

        self.eat(TokenType::FROM);
        let source = self.eat(TokenType::STRING).str_val().to_string();

        node!("ImportDecl", tok.line,
            "names" => json!(names),
            "defaultName" => default_name,
            "source" => json!(source)
        )
    }

    fn parse_export(&mut self) -> Value {
        let tok = self.eat(TokenType::EXPORT);
        let decl = self.parse_top_level().unwrap_or(Value::Null);
        node!("ExportDecl", tok.line, "declaration" => decl)
    }

    // ── Annotations ────────────────────────────────────────────────────────────

    fn parse_annotated_decl(&mut self) -> Value {
        let first_tok = self.tokens[self.pos].clone();
        let mut annotations = vec![];
        while self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::AT_IDENT) {
            annotations.push(self.tokens[self.pos].str_val().to_string());
            self.pos += 1;
        }

        let decl_annotations = ["@state","@computed","@build","@live","@realtime","@server","@worker","@param","@route"];
        let primary_idx = annotations.iter().position(|a| decl_annotations.contains(&a.as_str()));
        let primary = if let Some(idx) = primary_idx {
            annotations[idx].clone()
        } else {
            annotations.first().cloned().unwrap_or_default()
        };
        let extras: Vec<String> = annotations.iter().enumerate()
            .filter(|(i, _)| primary_idx.map_or(false, |pi| *i != pi) || primary_idx.is_none() && *i > 0)
            .map(|(_, a)| a.clone())
            .collect();

        let line = first_tok.line;
        match primary.as_str() {
            "@state" => self.parse_state_decl(line),
            "@computed" => self.parse_computed_decl(line),
            "@build" => self.parse_build_decl(line),
            "@live" => self.parse_live_decl(line),
            "@realtime" => self.parse_realtime_decl(line),
            "@server" => self.parse_server_fn(line),
            "@worker" => self.parse_worker_fn(line),
            "@param" => self.parse_param_decl(line),
            "@route" => {
                let mut node = self.parse_route_decl(line);
                if !extras.is_empty() {
                    if let Value::Object(ref mut m) = node {
                        m.insert("annotations".into(), json!(extras));
                    }
                }
                node
            }
            _ => {
                // Unknown annotation - skip
                node!("ExprStatement", line, "expr" => Value::Null)
            }
        }
    }

    fn parse_state_decl(&mut self, line: usize) -> Value {
        self.next_tok(); // consume const/let
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let type_ann = if self.eat_if(TokenType::COLON).is_some() { self.parse_type_annotation() } else { Value::Null };
        let init = if self.eat_if(TokenType::EQ).is_some() { self.parse_expr() } else { Value::Null };
        node!("StateDecl", line, "name" => json!(name), "typeAnnotation" => type_ann, "init" => init, "arcTag" => json!("reactive"))
    }

    fn parse_computed_decl(&mut self, line: usize) -> Value {
        self.next_tok();
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let type_ann = if self.eat_if(TokenType::COLON).is_some() { self.parse_type_annotation() } else { Value::Null };
        self.eat(TokenType::EQ);
        let init = self.parse_expr();
        node!("ComputedDecl", line, "name" => json!(name), "typeAnnotation" => type_ann, "init" => init, "arcTag" => json!("computed"))
    }

    fn parse_build_decl(&mut self, line: usize) -> Value {
        self.next_tok();
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let type_ann = if self.eat_if(TokenType::COLON).is_some() { self.parse_type_annotation() } else { Value::Null };
        self.eat(TokenType::EQ);
        let init = self.parse_expr();
        node!("BuildDecl", line, "name" => json!(name), "typeAnnotation" => type_ann, "init" => init, "arcTag" => json!("build"))
    }

    fn parse_live_decl(&mut self, line: usize) -> Value {
        self.next_tok();
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let type_ann = if self.eat_if(TokenType::COLON).is_some() { self.parse_type_annotation() } else { Value::Null };
        self.eat(TokenType::EQ);
        let init = self.parse_expr();
        node!("LiveDecl", line, "name" => json!(name), "typeAnnotation" => type_ann, "init" => init, "arcTag" => json!("live"))
    }

    fn parse_realtime_decl(&mut self, line: usize) -> Value {
        self.next_tok();
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let type_ann = if self.eat_if(TokenType::COLON).is_some() { self.parse_type_annotation() } else { Value::Null };
        self.eat(TokenType::EQ);
        let channel = self.parse_expr();
        node!("RealtimeDecl", line, "name" => json!(name), "typeAnnotation" => type_ann, "channel" => channel, "arcTag" => json!("realtime"))
    }

    fn parse_server_fn(&mut self, line: usize) -> Value {
        let fn_node = self.parse_fn_or_indented_fn();
        let name = fn_node["name"].clone();
        let params = fn_node["params"].clone();
        let return_type = fn_node["returnType"].clone();
        let body = fn_node["body"].clone();
        node!("ServerFn", line, "name" => name, "params" => params, "returnType" => return_type, "body" => body, "arcTag" => json!("server"))
    }

    fn parse_worker_fn(&mut self, line: usize) -> Value {
        let fn_node = self.parse_fn_or_indented_fn();
        let name = fn_node["name"].clone();
        let params = fn_node["params"].clone();
        let return_type = fn_node["returnType"].clone();
        let body = fn_node["body"].clone();
        node!("WorkerFn", line, "name" => name, "params" => params, "returnType" => return_type, "body" => body, "arcTag" => json!("worker"))
    }

    fn parse_fn_or_indented_fn(&mut self) -> Value {
        let tok = self.eat(TokenType::FN);
        let is_async = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::ASYNC) {
            self.pos += 1; true
        } else { false };
        let name_tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
        self.pos += 1;
        let name = name_tok.str_val().to_string();
        let params = self.parse_params();
        let return_type = if self.eat_if(TokenType::THIN_ARROW).is_some() { self.parse_type_annotation() } else { Value::Null };

        self.consume_newlines();
        let body = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            self.pos += 1;
            let stmts = self.parse_indented_stmts();
            node!("BlockStatement", tok.line, "body" => json!(stmts))
        } else if self.eat_if(TokenType::ARROW).is_some() {
            self.parse_expr()
        } else {
            self.parse_block()
        };

        node!("FnDecl", tok.line,
            "name" => json!(name),
            "params" => json!(params),
            "returnType" => return_type,
            "body" => body,
            "isAsync" => json!(is_async)
        )
    }

    fn parse_param_decl(&mut self, line: usize) -> Value {
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let type_ann = if self.eat_if(TokenType::COLON).is_some() { self.parse_type_annotation() } else { Value::Null };
        node!("VarDecl", line, "kind" => json!("const"), "name" => json!(name), "typeAnnotation" => type_ann, "init" => Value::Null)
    }

    // ── Widget / Page ──────────────────────────────────────────────────────────

    fn parse_widget(&mut self) -> Value {
        let tok = self.eat(TokenType::WIDGET);
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let params = if self.peek_kind(0) == &TokenType::LPAREN { self.parse_params() } else { vec![] };
        let mut body = self.parse_template_block();
        let design = if !body.is_empty() && body.last().and_then(|n: &Value| n.get("type")).and_then(|t| t.as_str()) == Some("DesignBlock") {
            body.pop()
        } else if self.check(&TokenType::DESIGN) {
            Some(self.parse_design())
        } else { None };

        node!("WidgetDecl", tok.line,
            "name" => json!(name),
            "params" => json!(params),
            "body" => json!(body),
            "design" => design.unwrap_or(Value::Null)
        )
    }

    fn parse_page(&mut self) -> Value {
        let tok = self.eat(TokenType::PAGE);
        let title = if self.peek_kind(0) == &TokenType::STRING {
            let v = self.next_tok();
            json!(v.str_val().to_string())
        } else { Value::Null };

        let mut meta = Map::new();
        while self.peek_kind(0) == &TokenType::IDENT && self.peek_kind(1) == &TokenType::EQ {
            let key = self.next_tok().str_val().to_string();
            self.eat(TokenType::EQ);
            let val = self.parse_expr();
            meta.insert(key, val);
        }

        let mut body = self.parse_template_block();
        let design = if !body.is_empty() && body.last().and_then(|n: &Value| n.get("type")).and_then(|t| t.as_str()) == Some("DesignBlock") {
            body.pop()
        } else if self.check(&TokenType::DESIGN) {
            Some(self.parse_design())
        } else { None };

        node!("PageDecl", tok.line,
            "title" => title,
            "meta" => Value::Object(meta),
            "body" => json!(body),
            "design" => design.unwrap_or(Value::Null)
        )
    }

    // ── Template ───────────────────────────────────────────────────────────────

    fn parse_template_block(&mut self) -> Vec<Value> {
        let mut children = vec![];
        self.consume_newlines();
        if self.tokens.get(self.pos).map_or(false, |t| t.kind != TokenType::INDENT) {
            return children;
        }
        self.pos += 1;

        loop {
            self.consume_newlines();
            match self.tokens.get(self.pos).map(|t| &t.kind) {
                None | Some(TokenType::DEDENT) | Some(TokenType::EOF) => {
                    if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::DEDENT) { self.pos += 1; }
                    break;
                }
                _ => {}
            }
            if let Some(node) = self.parse_template_node() {
                children.push(node);
            }
        }
        children
    }

    fn parse_template_node(&mut self) -> Option<Value> {
        let t = self.tokens.get(self.pos)?;
        if matches!(t.kind, TokenType::EOF | TokenType::DEDENT) { return None; }

        match &t.kind {
            TokenType::IF => return Some(self.parse_template_if()),
            TokenType::UNLESS => return Some(self.parse_template_unless()),
            TokenType::FOR => return Some(self.parse_template_for()),
            TokenType::MATCH => return Some(self.parse_template_match()),
            TokenType::CONST | TokenType::LET => return Some(self.parse_var_decl()),
            TokenType::RAW => return Some(self.parse_raw_node()),
            TokenType::AT_IDENT => {
                let annotation = t.str_val().to_string();
                let template_annotations = ["@state","@computed","@build","@live","@realtime","@server","@worker"];
                if template_annotations.contains(&annotation.as_str()) {
                    let decl = self.parse_annotated_decl();
                    self.hoisted_decls.push(decl);
                    return None;
                }
                self.pos += 1;
                return None;
            }
            TokenType::IDENT => return Some(self.parse_element()),
            TokenType::DOT => return Some(self.parse_dot_element()),
            TokenType::HASH => return Some(self.parse_hash_element()),
            TokenType::DESIGN => return Some(self.parse_design()),
            TokenType::STRING => {
                if self.tokens.get(self.pos + 1).map_or(false, |t| t.kind == TokenType::INTERP_START) {
                    return Some(self.parse_template_literal_content(t.line));
                }
                let line = t.line;
                let val = t.str_val().to_string();
                self.pos += 1;
                self.consume_newlines();
                return Some(node!("TextNode", line, "value" => json!(val), "arcTag" => Value::Null));
            }
            TokenType::LBRACE => return Some(self.parse_template_interpolation()),
            _ => { self.pos += 1; return None; }
        }
    }

    fn parse_element(&mut self) -> Value {
        let tok = self.tokens[self.pos].clone();
        let tag = tok.str_val().to_string();
        self.pos += 1;

        let mut classes = vec![];
        let mut id = Value::Null;

        while self.pos < self.tokens.len() {
            match self.tokens[self.pos].kind {
                TokenType::DOT => {
                    self.pos += 1;
                    if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::IDENT) {
                        classes.push(json!(self.tokens[self.pos].str_val().to_string()));
                        self.pos += 1;
                    }
                }
                TokenType::HASH => {
                    self.pos += 1;
                    if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::IDENT) {
                        id = json!(self.tokens[self.pos].str_val().to_string());
                        self.pos += 1;
                    }
                }
                _ => break,
            }
        }

        let attrs = self.parse_element_attrs();
        let inline_content = self.parse_inline_content();
        self.consume_newlines();
        let children = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            self.parse_template_block()
        } else { vec![] };

        let all_children: Vec<Value> = if let Some(ic) = inline_content {
            if children.is_empty() { vec![ic] } else { let mut v = vec![ic]; v.extend(children); v }
        } else { children };

        node!("Element", tok.line,
            "tag" => json!(tag),
            "classes" => json!(classes),
            "id" => id,
            "attrs" => json!(attrs),
            "children" => json!(all_children),
            "arcTag" => Value::Null
        )
    }

    fn parse_dot_element(&mut self) -> Value {
        self.pos += 1; // consume .
        let tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
        let mut classes = vec![json!(self.eat(TokenType::IDENT).str_val().to_string())];
        while self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::DOT) {
            self.pos += 1;
            if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::IDENT) {
                classes.push(json!(self.tokens[self.pos].str_val().to_string()));
                self.pos += 1;
            }
        }
        let attrs = self.parse_element_attrs();
        let inline_content = self.parse_inline_content();
        self.consume_newlines();
        let children = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            self.parse_template_block()
        } else { vec![] };
        let all_children: Vec<Value> = if let Some(ic) = inline_content {
            let mut v = vec![ic]; v.extend(children); v
        } else { children };
        node!("Element", tok.line, "tag" => json!("div"), "classes" => json!(classes), "id" => Value::Null, "attrs" => json!({}), "children" => json!(all_children), "arcTag" => Value::Null)
    }

    fn parse_hash_element(&mut self) -> Value {
        self.pos += 1; // consume #
        let tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
        let id = self.eat(TokenType::IDENT).str_val().to_string();
        let attrs = self.parse_element_attrs();
        let inline_content = self.parse_inline_content();
        self.consume_newlines();
        let children = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            self.parse_template_block()
        } else { vec![] };
        let all_children: Vec<Value> = if let Some(ic) = inline_content {
            let mut v = vec![ic]; v.extend(children); v
        } else { children };
        node!("Element", tok.line, "tag" => json!("div"), "classes" => json!([]), "id" => json!(id), "attrs" => json!({}), "children" => json!(all_children), "arcTag" => Value::Null)
    }

    fn parse_element_attrs(&mut self) -> Map<String, Value> {
        let mut attrs = Map::new();
        loop {
            let t = match self.tokens.get(self.pos) {
                Some(t) => t,
                None => break,
            };
            if matches!(t.kind, TokenType::NEWLINE | TokenType::INDENT | TokenType::DEDENT | TokenType::STRING | TokenType::LBRACE | TokenType::EOF) {
                break;
            }
            if t.kind == TokenType::IDENT {
                let next = self.tokens.get(self.pos + 1);
                if next.map_or(false, |n| n.kind == TokenType::COLON) {
                    let prefix = self.tokens[self.pos].str_val().to_string();
                    self.pos += 2;
                    let suffix = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::IDENT) {
                        let s = self.tokens[self.pos].str_val().to_string();
                        self.pos += 1;
                        s
                    } else { String::new() };
                    let attr_name = format!("{}:{}", prefix, suffix);
                    if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::EQ) {
                        self.pos += 1;
                        let val = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::LBRACE) {
                            self.pos += 1;
                            let v = self.parse_expr();
                            self.eat_if(TokenType::RBRACE);
                            v
                        } else { self.parse_expr() };
                        attrs.insert(attr_name, val);
                    } else {
                        attrs.insert(attr_name, json!(true));
                    }
                    continue;
                }
                if next.map_or(false, |n| n.kind == TokenType::EQ) {
                    let key = self.tokens[self.pos].str_val().to_string();
                    self.pos += 2;
                    let val = self.parse_expr();
                    attrs.insert(key, val);
                    continue;
                }
                // bare boolean attr
                let name = self.tokens[self.pos].str_val().to_string();
                if name.chars().next().map_or(false, |c| c.is_lowercase()) {
                    let after = self.tokens.get(self.pos + 1);
                    let is_end = after.map_or(true, |a| matches!(a.kind, TokenType::NEWLINE | TokenType::DEDENT | TokenType::EOF | TokenType::STRING | TokenType::LBRACE));
                    let is_more = after.map_or(false, |a| matches!(a.kind, TokenType::IDENT | TokenType::EQ | TokenType::COLON | TokenType::INDENT));
                    if is_end || is_more {
                        attrs.insert(name, json!(true));
                        self.pos += 1;
                        continue;
                    }
                }
            }
            break;
        }
        attrs
    }

    fn parse_inline_content(&mut self) -> Option<Value> {
        let t = self.tokens.get(self.pos)?;
        match &t.kind {
            TokenType::STRING => {
                if self.tokens.get(self.pos + 1).map_or(false, |t| t.kind == TokenType::INTERP_START) {
                    return Some(self.parse_template_literal_content(t.line));
                }
                let line = t.line;
                let val = t.str_val().to_string();
                self.pos += 1;
                self.consume_newlines();
                Some(node!("TextNode", line, "value" => json!(val), "arcTag" => Value::Null))
            }
            TokenType::LBRACE => Some(self.parse_template_interpolation()),
            _ => None,
        }
    }

    fn parse_template_literal_content(&mut self, line: usize) -> Value {
        let mut parts = vec![];
        loop {
            let t = match self.tokens.get(self.pos) {
                Some(t) => t,
                None => break,
            };
            if matches!(t.kind, TokenType::NEWLINE | TokenType::INDENT | TokenType::DEDENT | TokenType::EOF) { break; }
            match &t.kind {
                TokenType::STRING => {
                    let val = t.str_val().to_string();
                    let tline = t.line;
                    self.pos += 1;
                    if !val.is_empty() {
                        parts.push(node!("Literal", tline, "value" => json!(val), "raw" => json!(val)));
                    }
                }
                TokenType::INTERP_START => {
                    self.pos += 1;
                    let expr = self.parse_expr();
                    if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INTERP_END) { self.pos += 1; }
                    parts.push(expr);
                }
                _ => break,
            }
        }
        self.consume_newlines();
        if parts.len() == 1 {
            if let Some(v) = parts[0].get("type").and_then(|t| t.as_str()) {
                if v == "Literal" {
                    let val = parts[0]["value"].clone();
                    return node!("TextNode", line, "value" => val, "arcTag" => Value::Null);
                }
            }
        }
        node!("TemplateLiteral", line, "parts" => json!(parts))
    }

    fn parse_template_interpolation(&mut self) -> Value {
        let tok = self.tokens[self.pos].clone();
        self.pos += 1; // consume {
        let expr = self.parse_expr();
        self.eat_if(TokenType::RBRACE);
        self.consume_newlines();
        node!("InterpolationNode", tok.line, "expr" => expr, "arcTag" => Value::Null)
    }

    fn parse_template_if(&mut self) -> Value {
        let tok = self.eat(TokenType::IF);
        let condition = self.parse_expr();
        let consequent = self.parse_template_block();
        self.consume_newlines();
        let alternate = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::ELSE) {
            self.pos += 1;
            if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::IF) {
                Some(json!([self.parse_template_if()]))
            } else {
                Some(json!(self.parse_template_block()))
            }
        } else { None };
        node!("IfNode", tok.line,
            "condition" => condition,
            "consequent" => json!(consequent),
            "alternate" => alternate.unwrap_or(Value::Null),
            "arcTag" => Value::Null
        )
    }

    fn parse_template_unless(&mut self) -> Value {
        let tok = self.eat(TokenType::UNLESS);
        let condition = self.parse_expr();
        let consequent = self.parse_template_block();
        node!("UnlessNode", tok.line, "condition" => condition, "consequent" => json!(consequent), "arcTag" => Value::Null)
    }

    fn parse_template_for(&mut self) -> Value {
        let tok = self.eat(TokenType::FOR);
        let mut item_name = self.eat(TokenType::IDENT).str_val().to_string();
        let mut index_name = Value::Null;
        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::COMMA) {
            self.pos += 1;
            index_name = json!(item_name);
            item_name = self.eat(TokenType::IDENT).str_val().to_string();
        }
        self.eat(TokenType::IN);
        let collection = self.parse_expr();
        let body = self.parse_template_block();
        node!("ForNode", tok.line,
            "indexName" => index_name,
            "itemName" => json!(item_name),
            "collection" => collection,
            "body" => json!(body),
            "arcTag" => Value::Null
        )
    }

    fn parse_template_match(&mut self) -> Value {
        let tok = self.eat(TokenType::MATCH);
        let subject = self.parse_expr();
        let mut arms = vec![];
        self.skip_whitespace();
        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            self.pos += 1;
            while !matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) {
                self.consume_newlines();
                if matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT)) { break; }
                let pattern = self.parse_match_pattern();
                self.eat(TokenType::ARROW);
                let body = self.parse_template_node().unwrap_or(Value::Null);
                arms.push(json!({ "pattern": pattern, "body": body }));
                self.consume_newlines();
            }
            self.eat_if(TokenType::DEDENT);
        }
        node!("MatchTemplateNode", tok.line, "subject" => subject, "arms" => json!(arms))
    }

    fn parse_raw_node(&mut self) -> Value {
        let tok = self.eat(TokenType::RAW);
        let html = self.eat(TokenType::STRING).str_val().to_string();
        self.consume_newlines();
        node!("RawNode", tok.line, "html" => json!(html), "arcTag" => json!("raw"))
    }

    // ── Design ─────────────────────────────────────────────────────────────────

    fn parse_design(&mut self) -> Value {
        let tok = self.eat(TokenType::DESIGN);
        self.consume_newlines();
        if !self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            return node!("DesignBlock", tok.line, "rules" => json!([]));
        }
        self.pos += 1;

        let mut root_props = vec![];
        let mut nested_rules = vec![];

        while !matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) {
            self.consume_newlines();
            if matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) { break; }
            let pt = match self.tokens.get(self.pos) {
                Some(t) => t.clone(),
                None => break,
            };
            if matches!(pt.kind, TokenType::CONST | TokenType::LET | TokenType::FN | TokenType::CLASS | TokenType::WIDGET | TokenType::PAGE | TokenType::IMPORT | TokenType::EXPORT) { break; }

            match &pt.kind {
                TokenType::AT_IDENT => {
                    if let Some(cond) = self.parse_style_condition() { nested_rules.push(cond); }
                }
                TokenType::AMP => {
                    if let Some(rule) = self.parse_style_rule() { nested_rules.push(rule); }
                }
                TokenType::DOT => {
                    if let Some(rule) = self.parse_style_rule() { nested_rules.push(rule); }
                }
                TokenType::IDENT => {
                    let next = self.tokens.get(self.pos + 1);
                    if next.map_or(false, |n| n.kind == TokenType::COLON) {
                        let prop = self.parse_design_prop();
                        root_props.push(prop);
                        self.consume_newlines();
                    } else {
                        let mut look_idx = self.pos + 1;
                        while self.tokens.get(look_idx).map_or(false, |t| t.kind == TokenType::NEWLINE) { look_idx += 1; }
                        if self.tokens.get(look_idx).map_or(false, |t| t.kind == TokenType::INDENT) {
                            if let Some(rule) = self.parse_style_rule() { nested_rules.push(rule); }
                        } else { self.pos += 1; }
                    }
                }
                _ => { self.pos += 1; }
            }
        }
        self.eat_if(TokenType::DEDENT);

        let mut rules = vec![];
        if !root_props.is_empty() {
            rules.push(node!("StyleRule", tok.line, "selector" => json!("&"), "props" => json!(root_props), "children" => json!([])));
        }
        rules.extend(nested_rules);

        node!("DesignBlock", tok.line, "rules" => json!(rules))
    }

    fn parse_design_prop(&mut self) -> Value {
        let pt = self.tokens[self.pos].clone();
        let mut name = self.tokens[self.pos].str_val().to_string();
        self.pos += 1;
        while self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::MINUS)
            && self.tokens.get(self.pos + 1).map_or(false, |t| t.kind == TokenType::IDENT) {
            self.pos += 1;
            name.push('-');
            name.push_str(self.tokens[self.pos].str_val());
            self.pos += 1;
        }
        self.pos += 1; // consume colon
        let value = self.parse_style_value();
        node!("StyleProp", pt.line, "name" => json!(name), "value" => json!(value))
    }

    fn parse_style_rule(&mut self) -> Option<Value> {
        let t = self.tokens.get(self.pos)?.clone();
        if t.kind == TokenType::AT_IDENT {
            return self.parse_style_condition();
        }

        let mut selector = String::new();
        if t.kind == TokenType::AMP {
            self.pos += 1;
            selector = "&".to_string();
        }
        selector = self.build_selector(selector);
        if selector.trim().is_empty() { self.pos += 1; return None; }

        let mut props = vec![];
        let mut children = vec![];

        self.consume_newlines();
        if !self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            return Some(node!("StyleRule", t.line, "selector" => json!(selector), "props" => json!(props), "children" => json!(children)));
        }
        self.pos += 1;

        while !matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) {
            self.consume_newlines();
            if matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) { break; }
            let pt = match self.tokens.get(self.pos) {
                Some(t) => t.clone(),
                None => break,
            };
            if matches!(pt.kind, TokenType::CONST | TokenType::LET | TokenType::FN | TokenType::CLASS | TokenType::WIDGET | TokenType::PAGE | TokenType::IMPORT | TokenType::EXPORT) { break; }

            match &pt.kind {
                TokenType::AT_IDENT => { if let Some(c) = self.parse_style_condition() { children.push(c); } }
                TokenType::AMP => { if let Some(r) = self.parse_style_rule() { children.push(r); } }
                TokenType::DOT => { if let Some(r) = self.parse_style_rule() { children.push(r); } }
                TokenType::IDENT => {
                    let mut look_idx = self.pos + 1;
                    while self.tokens.get(look_idx).map_or(false, |t| t.kind == TokenType::NEWLINE) { look_idx += 1; }
                    if self.tokens.get(look_idx).map_or(false, |t| t.kind == TokenType::INDENT)
                        && !self.tokens.get(self.pos + 1).map_or(false, |t| t.kind == TokenType::COLON) {
                        if let Some(r) = self.parse_style_rule() { children.push(r); }
                    } else {
                        let mut prop_name = self.tokens[self.pos].str_val().to_string();
                        self.pos += 1;
                        while self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::MINUS)
                            && self.tokens.get(self.pos + 1).map_or(false, |t| t.kind == TokenType::IDENT) {
                            self.pos += 1;
                            prop_name.push('-');
                            prop_name.push_str(self.tokens[self.pos].str_val());
                            self.pos += 1;
                        }
                        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::COLON) {
                            self.pos += 1;
                            let value = self.parse_style_value();
                            props.push(node!("StyleProp", pt.line, "name" => json!(prop_name), "value" => json!(value)));
                        }
                        self.consume_newlines();
                    }
                }
                _ => { self.pos += 1; }
            }
        }
        self.eat_if(TokenType::DEDENT);

        Some(node!("StyleRule", t.line, "selector" => json!(selector), "props" => json!(props), "children" => json!(children)))
    }

    fn build_selector(&mut self, initial: String) -> String {
        let mut selector = initial;
        loop {
            let cur = match self.tokens.get(self.pos) {
                Some(t) => t,
                None => break,
            };
            match &cur.kind {
                TokenType::IDENT => { selector.push_str(cur.str_val()); self.pos += 1; }
                TokenType::DOT => { selector.push('.'); self.pos += 1; }
                TokenType::HASH => { selector.push('#'); self.pos += 1; }
                TokenType::COLON => { selector.push(':'); self.pos += 1; }
                TokenType::GT => { selector.push('>'); self.pos += 1; }
                TokenType::PLUS => { selector.push('+'); self.pos += 1; }
                TokenType::STAR => { selector.push('*'); self.pos += 1; }
                TokenType::MINUS => { selector.push('-'); self.pos += 1; }
                TokenType::COMMA => { selector.push_str(", "); self.pos += 1; }
                _ => break,
            }
        }
        selector
    }

    fn parse_style_condition(&mut self) -> Option<Value> {
        let tok = self.tokens.get(self.pos)?.clone();
        if tok.kind == TokenType::EOF { return None; }
        self.pos += 1;
        let annotation = tok.str_val().to_string();

        let mut query = Value::Null;
        if self.tokens.get(self.pos).map_or(false, |t| matches!(t.kind, TokenType::LT | TokenType::GT)) {
            let op_tok = self.tokens[self.pos].str_val().to_string();
            self.pos += 1;
            if let Some(size_tok) = self.tokens.get(self.pos) {
                let size = size_tok.str_val().to_string();
                self.pos += 1;
                let unit = self.tokens.get(self.pos).map(|t| t.str_val().to_string()).unwrap_or_default();
                if self.tokens.get(self.pos).map_or(false, |t| t.kind != TokenType::EOF) { self.pos += 1; }
                query = json!(format!("{} {}{}", op_tok, size, unit));
            }
        }

        let mut rules = vec![];
        self.consume_newlines();

        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::LBRACE) {
            self.pos += 1;
            while !matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::RBRACE) | Some(TokenType::EOF)) {
                let pt = match self.tokens.get(self.pos) {
                    Some(t) => t.clone(),
                    None => break,
                };
                if pt.kind == TokenType::IDENT {
                    let name = self.tokens[self.pos].str_val().to_string();
                    self.pos += 1;
                    if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::COLON) {
                        self.pos += 1;
                        let value = self.parse_style_value();
                        rules.push(node!("StyleProp", pt.line, "name" => json!(name), "value" => json!(value)));
                    }
                } else { self.pos += 1; }
            }
            self.eat_if(TokenType::RBRACE);
        } else if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            self.pos += 1;
            while !matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) {
                self.consume_newlines();
                if matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) { break; }
                let before = self.pos;
                if let Some(rule) = self.parse_style_rule() { rules.push(rule); }
                if self.pos == before { self.pos += 1; }
            }
            self.eat_if(TokenType::DEDENT);
        }

        let kind = annotation.trim_start_matches('@').to_string();
        Some(node!("StyleCondition", tok.line, "kind" => json!(kind), "query" => query, "rules" => json!(rules)))
    }

    fn parse_style_value(&mut self) -> String {
        let css_units = ["px","em","rem","%","vh","vw","vmin","vmax","svh","dvh","ch","ex","fr","deg","rad","ms","s"];
        let mut parts: Vec<String> = vec![];
        loop {
            let t = match self.tokens.get(self.pos) {
                Some(t) => t,
                None => break,
            };
            if matches!(t.kind, TokenType::NEWLINE | TokenType::INDENT | TokenType::DEDENT | TokenType::RBRACE | TokenType::EOF) { break; }

            match &t.kind {
                TokenType::HASH => {
                    self.pos += 1;
                    let next = self.tokens.get(self.pos);
                    if let Some(nt) = next {
                        if !matches!(nt.kind, TokenType::NEWLINE | TokenType::DEDENT | TokenType::EOF) {
                            let val = nt.str_val().to_string();
                            let num_val = if let TokenValue::Num(n) = nt.value { format!("{}", n) } else { val };
                            parts.push(format!("#{}", num_val));
                            self.pos += 1;
                            continue;
                        }
                    }
                    parts.push("#".to_string());
                }
                TokenType::MINUS => {
                    self.pos += 1;
                    let next = self.tokens.get(self.pos);
                    if !parts.is_empty() {
                        if let Some(nt) = next {
                            if nt.kind == TokenType::IDENT {
                                let last = parts.last_mut().unwrap();
                                last.push('-');
                                last.push_str(nt.str_val());
                                self.pos += 1;
                            } else {
                                let last = parts.last_mut().unwrap();
                                last.push('-');
                            }
                        } else {
                            let last = parts.last_mut().unwrap();
                            last.push('-');
                        }
                    } else { parts.push("-".to_string()); }
                }
                TokenType::COMMA => {
                    if !parts.is_empty() {
                        let last = parts.last_mut().unwrap();
                        last.push(',');
                    } else { parts.push(",".to_string()); }
                    self.pos += 1;
                }
                _ => {
                    let val = match &t.value {
                        TokenValue::Str(s) => s.clone(),
                        TokenValue::Num(n) => format!("{}", n),
                        TokenValue::Bool(b) => b.to_string(),
                        TokenValue::None => format!("{:?}", t.kind),
                    };
                    let is_unit = css_units.contains(&val.as_str());
                    let prev_is_num = parts.last().map_or(false, |p: &String| p.chars().next().map_or(false, |c| c.is_ascii_digit()));
                    if is_unit && prev_is_num {
                        let last = parts.last_mut().unwrap();
                        last.push_str(&val);
                    } else {
                        parts.push(val);
                    }
                    self.pos += 1;
                }
            }
        }
        self.consume_newlines();
        parts.join(" ").trim().to_string()
    }

    // ── Statements ─────────────────────────────────────────────────────────────

    fn parse_var_decl(&mut self) -> Value {
        let tok = self.tokens[self.pos].clone();
        let kind = tok.str_val().to_string();
        self.pos += 1;
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let type_ann = if self.eat_if(TokenType::COLON).is_some() { self.parse_type_annotation() } else { Value::Null };
        let init = if self.eat_if(TokenType::EQ).is_some() { self.parse_expr() } else { Value::Null };
        self.consume_newlines();
        node!("VarDecl", tok.line, "kind" => json!(kind), "name" => json!(name), "typeAnnotation" => type_ann, "init" => init)
    }

    fn parse_fn_decl(&mut self) -> Value {
        let tok = self.eat(TokenType::FN);
        let is_async = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::ASYNC) {
            self.pos += 1; true
        } else { false };
        let name_tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
        self.pos += 1;
        let name = name_tok.str_val().to_string();
        let params = self.parse_params();
        let return_type = if self.eat_if(TokenType::THIN_ARROW).is_some() { self.parse_type_annotation() } else { Value::Null };

        let body = if self.eat_if(TokenType::ARROW).is_some() {
            self.parse_expr()
        } else {
            self.parse_block()
        };
        self.consume_newlines();
        node!("FnDecl", tok.line,
            "name" => json!(name),
            "params" => json!(params),
            "returnType" => return_type,
            "body" => body,
            "isAsync" => json!(is_async)
        )
    }

    fn parse_params(&mut self) -> Vec<Value> {
        self.eat(TokenType::LPAREN);
        let mut params = vec![];
        while self.peek_kind(0) != &TokenType::RPAREN && self.peek_kind(0) != &TokenType::EOF {
            params.push(self.parse_param());
            self.eat_if(TokenType::COMMA);
        }
        self.eat(TokenType::RPAREN);
        params
    }

    fn parse_param(&mut self) -> Value {
        let tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
        let is_rest = self.eat_if(TokenType::SPREAD).is_some();
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let type_ann = if self.eat_if(TokenType::COLON).is_some() { self.parse_type_annotation() } else { Value::Null };
        let default_val = if self.eat_if(TokenType::EQ).is_some() { self.parse_expr() } else { Value::Null };
        node!("Param", tok.line,
            "name" => json!(name),
            "typeAnnotation" => type_ann,
            "defaultValue" => default_val,
            "rest" => json!(is_rest)
        )
    }

    fn parse_block(&mut self) -> Value {
        let tok = self.eat(TokenType::LBRACE);
        let mut body = vec![];
        while self.peek_kind(0) != &TokenType::RBRACE && self.peek_kind(0) != &TokenType::EOF {
            if let Some(stmt) = self.parse_statement() { body.push(stmt); }
        }
        self.eat(TokenType::RBRACE);
        node!("BlockStatement", tok.line, "body" => json!(body))
    }

    fn parse_class_decl(&mut self) -> Value {
        let tok = self.eat(TokenType::CLASS);
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let mut fields = vec![];
        let mut methods = vec![];

        self.eat(TokenType::LBRACE);
        while self.peek_kind(0) != &TokenType::RBRACE && self.peek_kind(0) != &TokenType::EOF {
            self.skip_whitespace();
            let t = match self.tokens.get(self.pos) {
                Some(t) if t.kind != TokenType::RBRACE => t.clone(),
                _ => break,
            };

            let is_static = if t.kind == TokenType::STATIC { self.pos += 1; true } else { false };

            if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::AT_IDENT && t.str_val() == "@get") {
                self.pos += 1;
                let method_name = self.eat(TokenType::IDENT).str_val().to_string();
                let params = self.parse_params();
                let return_type = if self.eat_if(TokenType::THIN_ARROW).is_some() { self.parse_type_annotation() } else { Value::Null };
                let body = if self.eat_if(TokenType::ARROW).is_some() { self.parse_expr() } else { self.parse_block() };
                self.consume_newlines();
                methods.push(node!("ClassMethod", t.line,
                    "name" => json!(method_name), "params" => json!(params), "returnType" => return_type,
                    "body" => body, "isStatic" => json!(is_static), "isGetter" => json!(true)
                ));
                continue;
            }

            if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::AT_IDENT) {
                let field_tok = self.tokens[self.pos].clone();
                self.pos += 1;
                let field_name = field_tok.str_val().trim_start_matches('@').to_string();
                let type_ann = if self.eat_if(TokenType::COLON).is_some() { self.parse_type_annotation() } else { Value::Null };
                let init = if self.eat_if(TokenType::EQ).is_some() { self.parse_expr() } else { Value::Null };
                self.consume_newlines();
                fields.push(node!("ClassField", field_tok.line,
                    "name" => json!(field_name), "typeAnnotation" => type_ann, "init" => init, "isStatic" => json!(is_static)
                ));
                continue;
            }

            if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::FN) {
                let fn_node = self.parse_fn_decl();
                let fn_name = fn_node["name"].clone();
                let fn_params = fn_node["params"].clone();
                let fn_ret = fn_node["returnType"].clone();
                let fn_body = fn_node["body"].clone();
                let fn_line = fn_node["line"].as_u64().unwrap_or(0) as usize;
                methods.push(node!("ClassMethod", fn_line,
                    "name" => fn_name, "params" => fn_params, "returnType" => fn_ret,
                    "body" => fn_body, "isStatic" => json!(is_static), "isGetter" => json!(false)
                ));
                continue;
            }

            self.pos += 1;
        }
        self.eat(TokenType::RBRACE);
        self.consume_newlines();
        node!("ClassDecl", tok.line, "name" => json!(name), "fields" => json!(fields), "methods" => json!(methods))
    }

    fn parse_statement(&mut self) -> Option<Value> {
        self.skip_whitespace();
        let t = self.tokens.get(self.pos)?;
        if matches!(t.kind, TokenType::EOF | TokenType::RBRACE) { return None; }

        match &t.kind {
            TokenType::CONST | TokenType::LET => Some(self.parse_var_decl()),
            TokenType::FN => Some(self.parse_fn_decl()),
            TokenType::CLASS => Some(self.parse_class_decl()),
            TokenType::RETURN => {
                let tok = self.next_tok();
                let value = if !matches!(self.peek_kind(0), TokenType::RBRACE | TokenType::NEWLINE | TokenType::EOF) {
                    self.parse_expr()
                } else { Value::Null };
                self.consume_newlines();
                Some(node!("ReturnStatement", tok.line, "argument" => value))
            }
            TokenType::IF => Some(self.parse_if_statement()),
            TokenType::UNLESS => Some(self.parse_unless_statement()),
            TokenType::WHILE => Some(self.parse_while_statement()),
            TokenType::UNTIL => Some(self.parse_until_statement()),
            TokenType::LOOP => Some(self.parse_loop_statement()),
            TokenType::FOR => Some(self.parse_for_statement()),
            TokenType::BREAK => { let tok = self.next_tok(); self.consume_newlines(); Some(node!("BreakStatement", tok.line)) }
            TokenType::CONTINUE => { let tok = self.next_tok(); self.consume_newlines(); Some(node!("ContinueStatement", tok.line)) }
            TokenType::THROW => {
                let tok = self.next_tok();
                let arg = self.parse_expr();
                self.consume_newlines();
                let throw_expr = node!("ThrowExpr", tok.line, "argument" => arg);
                Some(node!("ExprStatement", tok.line, "expr" => throw_expr))
            }
            TokenType::TRY => Some(self.parse_try_catch()),
            TokenType::MATCH => Some(self.parse_match_statement()),
            TokenType::AT_IDENT => Some(self.parse_annotated_decl()),
            _ => Some(self.parse_expr_statement()),
        }
    }

    fn parse_expr_statement(&mut self) -> Value {
        let tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
        let expr = self.parse_expr();
        self.consume_newlines();
        node!("ExprStatement", tok.line, "expr" => expr)
    }

    fn parse_block_or_indented(&mut self) -> Value {
        self.consume_newlines();
        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            self.parse_indented_block()
        } else {
            self.parse_block()
        }
    }

    fn parse_if_statement(&mut self) -> Value {
        let tok = self.eat(TokenType::IF);
        let condition = self.parse_expr();
        let consequent = self.parse_block_or_indented();
        let alternate = if self.eat_if(TokenType::ELSE).is_some() {
            if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::IF) {
                self.parse_if_statement()
            } else { self.parse_block_or_indented() }
        } else { Value::Null };
        self.consume_newlines();
        node!("IfStatement", tok.line, "condition" => condition, "consequent" => consequent, "alternate" => alternate)
    }

    fn parse_unless_statement(&mut self) -> Value {
        let tok = self.eat(TokenType::UNLESS);
        let condition = self.parse_expr();
        let body = self.parse_block_or_indented();
        self.consume_newlines();
        node!("UnlessStatement", tok.line, "condition" => condition, "body" => body)
    }

    fn parse_while_statement(&mut self) -> Value {
        let tok = self.eat(TokenType::WHILE);
        let condition = self.parse_expr();
        let body = self.parse_block_or_indented();
        self.consume_newlines();
        node!("WhileStatement", tok.line, "condition" => condition, "body" => body)
    }

    fn parse_until_statement(&mut self) -> Value {
        let tok = self.eat(TokenType::UNTIL);
        let condition = self.parse_expr();
        let body = self.parse_block();
        self.consume_newlines();
        node!("UntilStatement", tok.line, "condition" => condition, "body" => body)
    }

    fn parse_loop_statement(&mut self) -> Value {
        let tok = self.eat(TokenType::LOOP);
        let body = self.parse_block();
        self.consume_newlines();
        node!("LoopStatement", tok.line, "body" => body)
    }

    fn parse_for_statement(&mut self) -> Value {
        let tok = self.eat(TokenType::FOR);
        let mut item_name = self.eat(TokenType::IDENT).str_val().to_string();
        let mut index_name = Value::Null;
        if self.eat_if(TokenType::COMMA).is_some() {
            index_name = json!(item_name);
            item_name = self.eat(TokenType::IDENT).str_val().to_string();
        }
        self.eat(TokenType::IN);
        let collection = self.parse_expr();
        let body = self.parse_block_or_indented();
        self.consume_newlines();
        node!("ForStatement", tok.line,
            "indexName" => index_name,
            "itemName" => json!(item_name),
            "collection" => collection,
            "body" => body
        )
    }

    fn parse_try_catch(&mut self) -> Value {
        let tok = self.eat(TokenType::TRY);
        let try_body = self.parse_block();
        let (catch_param, catch_body) = if self.eat_if(TokenType::CATCH).is_some() {
            let param = if self.peek_kind(0) == &TokenType::IDENT {
                json!(self.eat(TokenType::IDENT).str_val().to_string())
            } else { Value::Null };
            (param, self.parse_block())
        } else { (Value::Null, Value::Null) };
        self.consume_newlines();
        node!("TryCatch", tok.line, "tryBody" => try_body, "catchParam" => catch_param, "catchBody" => catch_body)
    }

    fn parse_match_statement(&mut self) -> Value {
        let tok = self.eat(TokenType::MATCH);
        let subject = self.parse_expr();
        let arms = self.parse_match_arms();
        self.consume_newlines();
        node!("MatchStatement", tok.line, "subject" => subject, "arms" => json!(arms))
    }

    fn parse_match_arms(&mut self) -> Vec<Value> {
        let mut arms = vec![];
        self.consume_newlines();
        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            self.pos += 1;
            while !matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) {
                self.consume_newlines();
                if matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) { break; }
                let pattern = self.parse_match_pattern();
                let has_arrow = self.eat_if(TokenType::ARROW).is_some() || self.eat_if(TokenType::THIN_ARROW).is_some();
                if !has_arrow { break; }
                let body = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::NEWLINE) {
                    self.parse_indented_block()
                } else { self.parse_expr() };
                self.consume_newlines();
                let pline = pattern.get("line").and_then(|v| v.as_u64()).unwrap_or(0);
                arms.push(node!("MatchArm", pline, "pattern" => pattern, "body" => body));
            }
            if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::DEDENT) { self.pos += 1; }
        } else {
            self.eat(TokenType::LBRACE);
            while self.peek_kind(0) != &TokenType::RBRACE && self.peek_kind(0) != &TokenType::EOF {
                self.skip_whitespace();
                if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::RBRACE) { break; }
                let pattern = self.parse_match_pattern();
                let has_arrow = self.eat_if(TokenType::ARROW).is_some() || self.eat_if(TokenType::THIN_ARROW).is_some();
                if !has_arrow { break; }
                let body = self.parse_expr();
                self.eat_if(TokenType::COMMA);
                self.consume_newlines();
                let pline = pattern.get("line").and_then(|v| v.as_u64()).unwrap_or(0);
                arms.push(node!("MatchArm", pline, "pattern" => pattern, "body" => body));
            }
            self.eat(TokenType::RBRACE);
        }
        arms
    }

    fn parse_match_pattern(&mut self) -> Value {
        let t = match self.tokens.get(self.pos) {
            Some(t) => t.clone(),
            None => return Value::Null,
        };

        if t.kind == TokenType::IDENT && t.str_val() == "_" {
            self.pos += 1;
            return json!({ "type": "Wildcard", "line": t.line });
        }
        if t.kind == TokenType::NONE {
            self.pos += 1;
            return node!("Literal", t.line, "value" => Value::Null, "raw" => json!("none"));
        }
        if t.kind == TokenType::IDENT && self.tokens.get(self.pos + 1).map_or(false, |n| n.kind == TokenType::IS) {
            let name = t.str_val().to_string();
            self.pos += 2;
            let type_name = self.eat(TokenType::IDENT).str_val().to_string();
            return json!({ "type": "IsPattern", "name": name, "typeName": type_name, "line": t.line });
        }
        if t.kind == TokenType::LBRACE {
            self.pos += 1;
            let mut pairs = vec![];
            while !matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::RBRACE) | Some(TokenType::EOF)) {
                let key = self.eat(TokenType::IDENT).str_val().to_string();
                let val = if self.eat_if(TokenType::COLON).is_some() { self.eat(TokenType::IDENT).str_val().to_string() } else { key.clone() };
                pairs.push(json!({ "key": key, "val": val }));
                self.eat_if(TokenType::COMMA);
            }
            self.eat(TokenType::RBRACE);
            return json!({ "type": "ObjectPattern", "pairs": pairs, "line": t.line });
        }
        if (t.kind == TokenType::OK || t.kind == TokenType::ERR) && self.tokens.get(self.pos + 1).map_or(false, |n| n.kind == TokenType::LPAREN) {
            let kind = t.str_val().to_string();
            self.pos += 1;
            self.eat(TokenType::LPAREN);
            let name = self.eat(TokenType::IDENT).str_val().to_string();
            self.eat(TokenType::RPAREN);
            return json!({ "type": "ResultPattern", "kind": kind, "name": name, "line": t.line });
        }
        if t.kind == TokenType::IDENT && t.str_val() == "Some" && self.tokens.get(self.pos + 1).map_or(false, |n| n.kind == TokenType::LPAREN) {
            self.pos += 1;
            self.eat(TokenType::LPAREN);
            let name = self.eat(TokenType::IDENT).str_val().to_string();
            self.eat(TokenType::RPAREN);
            return json!({ "type": "VariantPattern", "variant": "Some", "name": name, "line": t.line });
        }
        if t.kind == TokenType::IDENT && t.str_val() == "None" {
            self.pos += 1;
            return json!({ "type": "VariantPattern", "variant": "None", "name": Value::Null, "line": t.line });
        }
        if t.kind == TokenType::IDENT && t.str_val().chars().next().map_or(false, |c| c.is_uppercase())
            && self.tokens.get(self.pos + 1).map_or(false, |n| n.kind == TokenType::LPAREN) {
            let tag = t.str_val().to_string();
            self.pos += 1;
            self.eat(TokenType::LPAREN);
            let name = self.eat(TokenType::IDENT).str_val().to_string();
            self.eat(TokenType::RPAREN);
            return json!({ "type": "VariantPattern", "variant": tag, "name": name, "line": t.line });
        }
        if t.kind == TokenType::IDENT {
            self.pos += 1;
            return node!("Identifier", t.line, "name" => json!(t.str_val().to_string()));
        }
        self.parse_expr()
    }

    // ── Expressions ────────────────────────────────────────────────────────────

    fn parse_expr(&mut self) -> Value {
        self.parse_assignment()
    }

    fn parse_assignment(&mut self) -> Value {
        let left = self.parse_pipeline();
        let t = match self.tokens.get(self.pos) {
            Some(t) => t.clone(),
            None => return left,
        };
        let assign_ops = [TokenType::EQ, TokenType::PLUS_EQ, TokenType::MINUS_EQ, TokenType::STAR_EQ, TokenType::SLASH_EQ];
        if assign_ops.iter().any(|k| k == &t.kind) {
            self.pos += 1;
            let right = self.parse_assignment();
            node!("AssignExpr", t.line, "op" => json!(t.str_val().to_string()), "target" => left, "value" => right)
        } else { left }
    }

    fn parse_pipeline(&mut self) -> Value {
        let mut left = self.parse_ternary();
        while self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::PIPE) {
            let tok = self.tokens[self.pos].clone();
            self.pos += 1;
            let right = self.parse_ternary();
            left = node!("PipelineExpr", tok.line, "left" => left, "right" => right);
        }
        left
    }

    fn parse_ternary(&mut self) -> Value {
        let cond = self.parse_or();
        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::QUESTION) {
            let tok = self.tokens[self.pos].clone();
            self.pos += 1;
            let cons = self.parse_or();
            self.eat(TokenType::COLON);
            let alt = self.parse_ternary();
            node!("TernaryExpr", tok.line, "condition" => cond, "consequent" => cons, "alternate" => alt)
        } else { cond }
    }

    fn parse_or(&mut self) -> Value {
        let mut left = self.parse_and();
        while self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::BARBAR) {
            let tok = self.tokens[self.pos].clone();
            self.pos += 1;
            left = node!("LogicalExpr", tok.line, "op" => json!("||"), "left" => left, "right" => self.parse_and());
        }
        left
    }

    fn parse_and(&mut self) -> Value {
        let mut left = self.parse_null_coalesce();
        while self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::AMPAMP) {
            let tok = self.tokens[self.pos].clone();
            self.pos += 1;
            left = node!("LogicalExpr", tok.line, "op" => json!("&&"), "left" => left, "right" => self.parse_null_coalesce());
        }
        left
    }

    fn parse_null_coalesce(&mut self) -> Value {
        let mut left = self.parse_equality();
        while self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::QQ) {
            let tok = self.tokens[self.pos].clone();
            self.pos += 1;
            left = node!("NullCoalesce", tok.line, "left" => left, "right" => self.parse_equality());
        }
        left
    }

    fn parse_equality(&mut self) -> Value {
        let mut left = self.parse_comparison();
        loop {
            let t = match self.tokens.get(self.pos) {
                Some(t) => t.clone(),
                None => break,
            };
            if matches!(t.kind, TokenType::EQEQ | TokenType::BANGEQ | TokenType::IS) {
                self.pos += 1;
                if t.kind == TokenType::IS {
                    let rhs = self.parse_unary();
                    left = node!("IsExpr", t.line, "subject" => left, "typeOrValue" => rhs);
                } else {
                    left = node!("BinaryExpr", t.line, "op" => json!(t.str_val().to_string()), "left" => left, "right" => self.parse_comparison());
                }
            } else { break; }
        }
        left
    }

    fn parse_comparison(&mut self) -> Value {
        let mut left = self.parse_add_sub();
        loop {
            let t = match self.tokens.get(self.pos) {
                Some(t) => t.clone(),
                None => break,
            };
            if matches!(t.kind, TokenType::LT | TokenType::GT | TokenType::LTEQ | TokenType::GTEQ) {
                self.pos += 1;
                left = node!("BinaryExpr", t.line, "op" => json!(t.str_val().to_string()), "left" => left, "right" => self.parse_add_sub());
            } else { break; }
        }
        left
    }

    fn parse_add_sub(&mut self) -> Value {
        let mut left = self.parse_mul_div();
        loop {
            let t = match self.tokens.get(self.pos) {
                Some(t) => t.clone(),
                None => break,
            };
            if matches!(t.kind, TokenType::PLUS | TokenType::MINUS) {
                self.pos += 1;
                left = node!("BinaryExpr", t.line, "op" => json!(t.str_val().to_string()), "left" => left, "right" => self.parse_mul_div());
            } else { break; }
        }
        left
    }

    fn parse_mul_div(&mut self) -> Value {
        let mut left = self.parse_unary();
        loop {
            let t = match self.tokens.get(self.pos) {
                Some(t) => t.clone(),
                None => break,
            };
            if matches!(t.kind, TokenType::STAR | TokenType::SLASH | TokenType::PERCENT | TokenType::STARSTAR) {
                self.pos += 1;
                left = node!("BinaryExpr", t.line, "op" => json!(t.str_val().to_string()), "left" => left, "right" => self.parse_unary());
            } else { break; }
        }
        left
    }

    fn parse_unary(&mut self) -> Value {
        let t = match self.tokens.get(self.pos) {
            Some(t) => t.clone(),
            None => return self.parse_postfix(),
        };
        match &t.kind {
            TokenType::BANG => { self.pos += 1; let operand = self.parse_unary(); node!("UnaryExpr", t.line, "op" => json!("!"), "operand" => operand) }
            TokenType::MINUS => { self.pos += 1; let operand = self.parse_unary(); node!("UnaryExpr", t.line, "op" => json!("-"), "operand" => operand) }
            TokenType::AWAIT => { self.pos += 1; let arg = self.parse_unary(); node!("AwaitExpr", t.line, "argument" => arg) }
            TokenType::YIELD => { self.pos += 1; let arg = self.parse_unary(); node!("YieldExpr", t.line, "argument" => arg) }
            TokenType::TRY => { self.pos += 1; let expr = self.parse_unary(); node!("TryExpr", t.line, "expr" => expr) }
            _ => self.parse_postfix(),
        }
    }

    fn parse_postfix(&mut self) -> Value {
        let mut expr = self.parse_primary();
        loop {
            let t = match self.tokens.get(self.pos) {
                Some(t) => t.clone(),
                None => break,
            };
            match &t.kind {
                TokenType::DOT => {
                    self.pos += 1;
                    let prop_tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
                    self.pos += 1;
                    let prop = node!("Identifier", t.line, "name" => json!(prop_tok.str_val().to_string()));
                    expr = node!("MemberExpr", t.line, "object" => expr, "property" => prop, "computed" => json!(false));
                }
                TokenType::QQDOT => {
                    self.pos += 1;
                    let prop_tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
                    self.pos += 1;
                    let prop = node!("Identifier", t.line, "name" => json!(prop_tok.str_val().to_string()));
                    expr = node!("OptionalChain", t.line, "object" => expr, "property" => prop);
                }
                TokenType::LBRACKET => {
                    self.pos += 1;
                    let index = self.parse_expr();
                    self.eat(TokenType::RBRACKET);
                    expr = node!("MemberExpr", t.line, "object" => expr, "property" => index, "computed" => json!(true));
                }
                TokenType::LPAREN => {
                    let args = self.parse_call_args();
                    expr = node!("CallExpr", t.line, "callee" => expr, "args" => json!(args));
                }
                TokenType::DOTDOT => {
                    self.pos += 1;
                    let end = self.parse_range_bound();
                    expr = node!("RangeExpr", t.line, "start" => expr, "end" => end, "inclusive" => json!(false));
                    break;
                }
                TokenType::DOTDOTEQ => {
                    self.pos += 1;
                    let end = self.parse_range_bound();
                    expr = node!("RangeExpr", t.line, "start" => expr, "end" => end, "inclusive" => json!(true));
                    break;
                }
                _ => break,
            }
        }
        expr
    }

    fn parse_range_bound(&mut self) -> Value {
        let mut e = self.parse_primary();
        loop {
            let t = match self.tokens.get(self.pos) {
                Some(t) => t.clone(),
                None => break,
            };
            match &t.kind {
                TokenType::DOT => {
                    self.pos += 1;
                    let prop_tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
                    self.pos += 1;
                    let prop = node!("Identifier", t.line, "name" => json!(prop_tok.str_val().to_string()));
                    e = node!("MemberExpr", t.line, "object" => e, "property" => prop, "computed" => json!(false));
                }
                TokenType::LBRACKET => {
                    self.pos += 1;
                    let index = self.parse_expr();
                    self.eat(TokenType::RBRACKET);
                    e = node!("MemberExpr", t.line, "object" => e, "property" => index, "computed" => json!(true));
                }
                TokenType::LPAREN => {
                    let args = self.parse_call_args();
                    e = node!("CallExpr", t.line, "callee" => e, "args" => json!(args));
                }
                _ => break,
            }
        }
        e
    }

    fn parse_call_args(&mut self) -> Vec<Value> {
        self.eat(TokenType::LPAREN);
        let mut args = vec![];
        while self.peek_kind(0) != &TokenType::RPAREN && self.peek_kind(0) != &TokenType::EOF {
            if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::SPREAD) {
                let tok = self.tokens[self.pos].clone();
                self.pos += 1;
                let expr = self.parse_expr();
                args.push(node!("SpreadElement", tok.line, "argument" => expr));
            } else {
                args.push(self.parse_expr());
            }
            self.eat_if(TokenType::COMMA);
        }
        self.eat(TokenType::RPAREN);
        args
    }

    fn parse_primary(&mut self) -> Value {
        self.skip_whitespace();
        let t = match self.tokens.get(self.pos) {
            Some(t) => t.clone(),
            None => return node!("Literal", 0, "value" => Value::Null, "raw" => json!("none")),
        };

        match &t.kind {
            TokenType::NUMBER => {
                self.pos += 1;
                let n = t.num_val();
                node!("Literal", t.line, "value" => json!(n), "raw" => json!(n.to_string()))
            }
            TokenType::BOOL => {
                self.pos += 1;
                let b = if let TokenValue::Bool(b) = t.value { b } else { false };
                node!("Literal", t.line, "value" => json!(b), "raw" => json!(b.to_string()))
            }
            TokenType::NONE => {
                self.pos += 1;
                node!("Literal", t.line, "value" => Value::Null, "raw" => json!("none"))
            }
            TokenType::STRING => {
                self.pos += 1;
                // Check for interpolation
                if self.tokens.get(self.pos).map_or(false, |nt| nt.kind == TokenType::INTERP_START) {
                    // Build TemplateLiteral
                    let mut parts = vec![];
                    if !t.str_val().is_empty() {
                        parts.push(node!("Literal", t.line, "value" => json!(t.str_val().to_string()), "raw" => json!(t.str_val().to_string())));
                    }
                    while self.tokens.get(self.pos).map_or(false, |nt| nt.kind == TokenType::INTERP_START) {
                        self.pos += 1; // consume INTERP_START
                        let expr = self.parse_expr();
                        parts.push(expr);
                        if self.tokens.get(self.pos).map_or(false, |nt| nt.kind == TokenType::INTERP_END) { self.pos += 1; }
                        if self.tokens.get(self.pos).map_or(false, |nt| nt.kind == TokenType::STRING) {
                            let s = self.tokens[self.pos].str_val().to_string();
                            let sline = self.tokens[self.pos].line;
                            self.pos += 1;
                            if !s.is_empty() {
                                parts.push(node!("Literal", sline, "value" => json!(s), "raw" => json!(s)));
                            }
                        }
                    }
                    node!("TemplateLiteral", t.line, "parts" => json!(parts))
                } else {
                    let s = t.str_val().to_string();
                    let raw = format!("\"{}\"", s);
                    node!("Literal", t.line, "value" => json!(s), "raw" => json!(raw))
                }
            }
            TokenType::AT_IDENT => {
                self.pos += 1;
                let name = t.str_val().trim_start_matches('@').to_string();
                node!("AtProperty", t.line, "name" => json!(name))
            }
            TokenType::IDENT => {
                // Check for arrow fn: x => expr
                if self.tokens.get(self.pos + 1).map_or(false, |n| n.kind == TokenType::ARROW) {
                    self.pos += 1;
                    self.eat(TokenType::ARROW);
                    let body = self.parse_expr();
                    let param = node!("Param", t.line, "name" => json!(t.str_val().to_string()), "typeAnnotation" => Value::Null, "defaultValue" => Value::Null, "rest" => json!(false));
                    return node!("ArrowFn", t.line, "params" => json!([param]), "body" => body, "isAsync" => json!(false));
                }
                self.pos += 1;
                node!("Identifier", t.line, "name" => json!(t.str_val().to_string()))
            }
            TokenType::OK => {
                self.pos += 1;
                self.eat(TokenType::LPAREN);
                let v = self.parse_expr();
                self.eat(TokenType::RPAREN);
                node!("ResultOk", t.line, "value" => v)
            }
            TokenType::ERR => {
                self.pos += 1;
                self.eat(TokenType::LPAREN);
                let v = self.parse_expr();
                self.eat(TokenType::RPAREN);
                node!("ResultErr", t.line, "value" => v)
            }
            TokenType::LPAREN => self.parse_arrow_fn_from_parens(t),
            TokenType::LBRACKET => self.parse_array_literal(t),
            TokenType::LBRACE => self.parse_object_literal(t),
            TokenType::FN => {
                self.pos += 1;
                let params = if self.peek_kind(0) == &TokenType::IDENT && self.tokens.get(self.pos + 1).map_or(false, |n| n.kind == TokenType::ARROW) {
                    let p_tok = self.tokens[self.pos].clone();
                    self.pos += 1;
                    vec![node!("Param", p_tok.line, "name" => json!(p_tok.str_val().to_string()), "typeAnnotation" => Value::Null, "defaultValue" => Value::Null, "rest" => json!(false))]
                } else {
                    self.parse_params()
                };
                if self.eat_if(TokenType::ARROW).is_some() {
                    node!("ArrowFn", t.line, "params" => json!(params), "body" => self.parse_expr(), "isAsync" => json!(false))
                } else {
                    node!("ArrowFn", t.line, "params" => json!(params), "body" => self.parse_block(), "isAsync" => json!(false))
                }
            }
            TokenType::MATCH => {
                self.pos += 1;
                let subject = self.parse_expr();
                let arms = self.parse_match_arms();
                node!("MatchExpr", t.line, "subject" => subject, "arms" => json!(arms))
            }
            TokenType::NEW => {
                self.pos += 1;
                let callee_name = self.eat(TokenType::IDENT).str_val().to_string();
                let callee = node!("Identifier", t.line, "name" => json!(callee_name));
                let args = if self.peek_kind(0) == &TokenType::LPAREN { self.parse_call_args() } else { vec![] };
                let member = node!("MemberExpr", t.line, "object" => Value::Null, "property" => callee, "computed" => json!(false));
                node!("CallExpr", t.line, "callee" => member, "args" => json!(args))
            }
            _ => {
                self.pos += 1;
                node!("Literal", t.line, "value" => Value::Null, "raw" => json!("none"))
            }
        }
    }

    fn parse_arrow_fn_from_parens(&mut self, t: Token) -> Value {
        self.pos += 1;
        if self.peek_kind(0) == &TokenType::RPAREN {
            self.eat(TokenType::RPAREN);
            self.eat(TokenType::ARROW);
            let body = self.parse_expr();
            return node!("ArrowFn", t.line, "params" => json!([]), "body" => body, "isAsync" => json!(false));
        }
        let expr = self.parse_expr();
        if self.eat_if(TokenType::RPAREN).is_some() {
            if self.tokens.get(self.pos).map_or(false, |n| n.kind == TokenType::ARROW) {
                self.pos += 1;
                let body = self.parse_expr();
                let params = if expr.get("type").and_then(|t| t.as_str()) == Some("Identifier") {
                    let name = expr["name"].as_str().unwrap_or("").to_string();
                    let eline = expr["line"].as_u64().unwrap_or(0) as usize;
                    vec![node!("Param", eline, "name" => json!(name), "typeAnnotation" => Value::Null, "defaultValue" => Value::Null, "rest" => json!(false))]
                } else { vec![expr] };
                return node!("ArrowFn", t.line, "params" => json!(params), "body" => body, "isAsync" => json!(false));
            }
            return expr;
        }
        // Multi params
        let eline = expr.get("line").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        let first_name = expr.get("name").and_then(|v| v.as_str()).unwrap_or("__p").to_string();
        let mut params = vec![node!("Param", eline, "name" => json!(first_name), "typeAnnotation" => Value::Null, "defaultValue" => Value::Null, "rest" => json!(false))];
        while self.eat_if(TokenType::COMMA).is_some() {
            let rest = self.eat_if(TokenType::SPREAD).is_some();
            let name = self.eat(TokenType::IDENT).str_val().to_string();
            params.push(node!("Param", t.line, "name" => json!(name), "typeAnnotation" => Value::Null, "defaultValue" => Value::Null, "rest" => json!(rest)));
        }
        self.eat(TokenType::RPAREN);
        self.eat(TokenType::ARROW);
        let body = self.parse_expr();
        node!("ArrowFn", t.line, "params" => json!(params), "body" => body, "isAsync" => json!(false))
    }

    fn parse_array_literal(&mut self, t: Token) -> Value {
        self.pos += 1;
        let mut elements = vec![];
        while self.peek_kind(0) != &TokenType::RBRACKET && self.peek_kind(0) != &TokenType::EOF {
            if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::SPREAD) {
                let st = self.tokens[self.pos].clone();
                self.pos += 1;
                elements.push(node!("SpreadElement", st.line, "argument" => self.parse_expr()));
            } else {
                elements.push(self.parse_expr());
            }
            self.eat_if(TokenType::COMMA);
        }
        self.eat(TokenType::RBRACKET);
        node!("ArrayLiteral", t.line, "elements" => json!(elements))
    }

    fn parse_object_literal(&mut self, t: Token) -> Value {
        self.pos += 1;
        self.consume_newlines();
        while self.tokens.get(self.pos).map_or(false, |t| matches!(t.kind, TokenType::INDENT | TokenType::DEDENT)) { self.pos += 1; }
        self.consume_newlines();
        let mut props = vec![];
        while self.peek_kind(0) != &TokenType::RBRACE && self.peek_kind(0) != &TokenType::EOF {
            if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::SPREAD) {
                let st = self.tokens[self.pos].clone();
                self.pos += 1;
                props.push(node!("SpreadElement", st.line, "argument" => self.parse_expr()));
            } else {
                let key_tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
                if key_tok.kind == TokenType::LBRACKET {
                    self.pos += 1;
                    let key_expr = self.parse_expr();
                    self.eat(TokenType::RBRACKET);
                    let val = if self.eat_if(TokenType::COLON).is_some() { self.parse_expr() } else { Value::Null };
                    props.push(node!("ObjectProp", t.line, "key" => Value::Null, "value" => val, "shorthand" => json!(false), "computedKey" => key_expr));
                } else {
                    let key = if key_tok.kind == TokenType::STRING {
                        self.pos += 1;
                        key_tok.str_val().to_string()
                    } else {
                        let k = key_tok.str_val().to_string();
                        self.pos += 1;
                        k
                    };
                    if self.eat_if(TokenType::COLON).is_some() {
                        let val = self.parse_expr();
                        props.push(node!("ObjectProp", t.line, "key" => json!(key), "value" => val, "shorthand" => json!(false), "computedKey" => Value::Null));
                    } else if self.peek_kind(0) == &TokenType::LPAREN {
                        let params = self.parse_params();
                        let body = self.parse_block();
                        let fn_val = node!("ArrowFn", t.line, "params" => json!(params), "body" => body, "isAsync" => json!(false));
                        props.push(node!("ObjectProp", t.line, "key" => json!(key), "value" => fn_val, "shorthand" => json!(false), "computedKey" => Value::Null));
                    } else {
                        let ident = node!("Identifier", key_tok.line, "name" => json!(key.clone()));
                        props.push(node!("ObjectProp", t.line, "key" => json!(key), "value" => ident, "shorthand" => json!(true), "computedKey" => Value::Null));
                    }
                }
            }
            self.eat_if(TokenType::COMMA);
            self.consume_newlines();
            while self.tokens.get(self.pos).map_or(false, |t| matches!(t.kind, TokenType::INDENT | TokenType::DEDENT)) { self.pos += 1; }
            self.consume_newlines();
        }
        self.eat(TokenType::RBRACE);
        node!("ObjectLiteral", t.line, "properties" => json!(props))
    }

    // ── Type Annotations ───────────────────────────────────────────────────────

    fn parse_type_annotation(&mut self) -> Value {
        let t = match self.tokens.get(self.pos) {
            Some(t) => t.clone(),
            None => return Value::Null,
        };

        if t.kind == TokenType::LBRACE {
            self.pos += 1;
            let mut fields = Map::new();
            while self.peek_kind(0) != &TokenType::RBRACE && self.peek_kind(0) != &TokenType::EOF {
                let key = self.tokens[self.pos.min(self.tokens.len()-1)].str_val().to_string();
                self.pos += 1;
                self.eat_if(TokenType::COLON);
                fields.insert(key, self.parse_type_annotation());
                self.eat_if(TokenType::COMMA);
            }
            self.eat_if(TokenType::RBRACE);
            return node!("ObjectType", t.line, "fields" => Value::Object(fields));
        }

        if t.kind == TokenType::NONE {
            self.pos += 1;
            return node!("TypeAnnotation", t.line, "name" => json!("none"), "args" => json!([]), "nullable" => json!(false));
        }

        if t.kind != TokenType::IDENT { return Value::Null; }

        let name = t.str_val().to_string();
        self.pos += 1;
        let mut args = vec![];
        let mut nullable = false;

        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::LT) {
            self.pos += 1;
            args.push(self.parse_type_annotation());
            while self.eat_if(TokenType::COMMA).is_some() { args.push(self.parse_type_annotation()); }
            self.eat_if(TokenType::GT);
        }

        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::LBRACKET)
            && self.tokens.get(self.pos + 1).map_or(false, |t| t.kind == TokenType::RBRACKET) {
            self.pos += 2;
            let inner = node!("TypeAnnotation", t.line, "name" => json!(name), "args" => json!(args), "nullable" => json!(false));
            return node!("ArrayType", t.line, "elementType" => inner);
        }

        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::QUESTION) {
            self.pos += 1;
            nullable = true;
        }

        if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::BAR) {
            let mut members = vec![node!("TypeAnnotation", t.line, "name" => json!(name), "args" => json!(args), "nullable" => json!(nullable))];
            while self.eat_if(TokenType::BAR).is_some() {
                let next = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
                self.pos += 1;
                members.push(node!("TypeAnnotation", next.line, "name" => json!(next.str_val().to_string()), "args" => json!([]), "nullable" => json!(false)));
            }
            return node!("UnionType", t.line, "members" => json!(members));
        }

        node!("TypeAnnotation", t.line, "name" => json!(name), "args" => json!(args), "nullable" => json!(nullable))
    }

    // ── Backend ────────────────────────────────────────────────────────────────

    fn parse_indented_block(&mut self) -> Value {
        let line = self.tokens.get(self.pos).map_or(0, |t| t.line);
        self.consume_newlines();
        if !self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            return node!("BlockStatement", line, "body" => json!([]));
        }
        self.pos += 1;
        let stmts = self.parse_indented_stmts();
        node!("BlockStatement", line, "body" => json!(stmts))
    }

    fn parse_indented_stmts(&mut self) -> Vec<Value> {
        let mut stmts = vec![];
        loop {
            self.consume_newlines();
            if matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) {
                if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::DEDENT) { self.pos += 1; }
                break;
            }
            if let Some(stmt) = self.parse_statement() { stmts.push(stmt); }
        }
        stmts
    }

    fn parse_model_decl(&mut self) -> Value {
        let tok = self.eat(TokenType::MODEL);
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        self.consume_newlines();
        if !self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::INDENT) {
            return node!("ModelDecl", tok.line, "name" => json!(name), "fields" => json!([]), "arcTag" => json!("model"));
        }
        self.pos += 1;
        let mut fields = vec![];
        while !matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) {
            self.consume_newlines();
            if matches!(self.tokens.get(self.pos).map(|t| &t.kind), None | Some(TokenType::DEDENT) | Some(TokenType::EOF)) { break; }
            fields.push(self.parse_model_field());
            self.consume_newlines();
        }
        self.eat_if(TokenType::DEDENT);
        node!("ModelDecl", tok.line, "name" => json!(name), "fields" => json!(fields), "arcTag" => json!("model"))
    }

    fn parse_model_field(&mut self) -> Value {
        let mut decorators = vec![];
        while self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::AT_IDENT) {
            decorators.push(json!(self.tokens[self.pos].str_val().to_string()));
            self.pos += 1;
        }
        // Standalone decorator line
        if !decorators.is_empty() && !matches!(self.tokens.get(self.pos).map(|t| &t.kind), Some(TokenType::LET) | Some(TokenType::CONST)) {
            let expr_line = self.tokens.get(self.pos).map_or(0, |t| t.line);
            let expr = self.parse_expr();
            return node!("ModelField", expr_line, "decorators" => json!(decorators), "name" => Value::Null, "typeAnnotation" => Value::Null, "init" => expr);
        }
        let kw_tok = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::CONST) {
            self.eat(TokenType::CONST)
        } else {
            self.eat(TokenType::LET)
        };
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let type_ann = if self.eat_if(TokenType::COLON).is_some() { self.parse_type_annotation() } else { Value::Null };
        let init = if self.tokens.get(self.pos).map_or(false, |t| t.kind == TokenType::EQ) {
            self.pos += 1;
            self.parse_expr()
        } else { Value::Null };
        node!("ModelField", kw_tok.line, "decorators" => json!(decorators), "name" => json!(name), "typeAnnotation" => type_ann, "init" => init)
    }

    fn parse_job_decl(&mut self) -> Value {
        let tok = self.eat(TokenType::JOB);
        let name = self.eat(TokenType::IDENT).str_val().to_string();
        let params = self.parse_params();
        let body = self.parse_indented_block();
        node!("JobDecl", tok.line, "name" => json!(name), "params" => json!(params), "body" => body, "arcTag" => json!("job"))
    }

    fn parse_route_decl(&mut self, line: usize) -> Value {
        self.skip_whitespace();
        let method_tok = self.tokens[self.pos.min(self.tokens.len()-1)].clone();
        self.pos += 1;
        let raw_method = method_tok.str_val().to_uppercase();
        let raw_method = if raw_method.is_empty() { format!("{:?}", method_tok.kind).to_uppercase() } else { raw_method };
        let method = match raw_method.as_str() {
            "DEL" => "DELETE".to_string(),
            "PATCH" => "PATCH".to_string(),
            other => other.to_string(),
        };

        let path_tok = self.eat(TokenType::STRING);
        let route_path = path_tok.str_val().to_string();

        // Extract params from path like /posts/:id
        let params: Vec<Value> = {
            let mut ps = vec![];
            let mut i = 0;
            let chars: Vec<char> = route_path.chars().collect();
            while i < chars.len() {
                if chars[i] == ':' {
                    i += 1;
                    let start = i;
                    while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') { i += 1; }
                    let param_name: String = chars[start..i].iter().collect();
                    if !param_name.is_empty() { ps.push(json!(param_name)); }
                } else { i += 1; }
            }
            ps
        };

        let return_type = if self.eat_if(TokenType::THIN_ARROW).is_some() { self.parse_type_annotation() } else { Value::Null };
        let body = self.parse_indented_block();

        node!("RouteDecl", line,
            "method" => json!(method),
            "path" => json!(route_path),
            "params" => json!(params),
            "returnType" => return_type,
            "body" => body,
            "annotations" => json!([]),
            "arcTag" => json!("route")
        )
    }
}

pub fn parse(tokens: Vec<Token>) -> Value {
    let mut parser = Parser::new(tokens);
    parser.parse()
}
