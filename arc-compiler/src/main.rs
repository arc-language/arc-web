mod lexer;
mod parser;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: arc-compiler <file.arc>");
        std::process::exit(1);
    }
    let source = std::fs::read_to_string(&args[1]).expect("could not read file");
    let tokens = lexer::lex(&source, &args[1]);
    let ast = parser::parse(tokens);
    println!("{}", serde_json::to_string(&ast).unwrap());
}
