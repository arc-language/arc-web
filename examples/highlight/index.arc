import { Code } from "../../stdlib/highlight"

page "Syntax Highlighting"
  meta description="Arc Code widget — zero-JS pre-render, ~2KB runtime tokenizer"

  main
    h1 "Arc Code Highlight"

    h2 "JavaScript"
    Code lang="javascript"
      `// Arrow function with destructuring
const greet = ({ name, role = "user" }) => {
  const msg = \`Hello, \${name}!\`
  console.log(msg)
  return { success: true, count: 42 }
}`

    h2 "TypeScript"
    Code lang="typescript"
      `interface User {
  id: number
  name: string
  role?: "admin" | "user"
}

async function fetchUser(id: number): Promise<User> {
  const res = await fetch(\`/api/users/\${id}\`)
  return res.json() as User
}`

    h2 "Python"
    Code lang="python"
      `import asyncio
from typing import Optional

async def fetch_data(url: str, retries: int = 3) -> Optional[dict]:
    for attempt in range(retries):
        try:
            return await get(url)
        except Exception as e:
            if attempt == retries - 1:
                raise
    return None`

    h2 "SQL"
    Code lang="sql"
      `SELECT u.name, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.created_at > '2024-01-01'
GROUP BY u.id, u.name
HAVING COUNT(o.id) > 5
ORDER BY order_count DESC
LIMIT 20`

    h2 "Shell"
    Code lang="bash"
      `#!/bin/bash
# Deploy script
if [ -z "$VERSION" ]; then
  echo "Usage: VERSION=1.0.0 ./deploy.sh"
  exit 1
fi
export NODE_ENV=production
npm run build && rsync -av dist/ server:/var/www/`

    h2 "JSON"
    Code lang="json"
      `{
  "name": "arc-app",
  "version": "1.0.0",
  "scripts": {
    "build": "arc build",
    "dev": "arc dev --port 3000"
  },
  "dependencies": {}
}`

    h2 "Light Theme"
    Code lang="javascript" theme="light"
      `const fibonacci = (n) => {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}`

  design
    main
      max-width: 800px
      margin: 0 auto
      padding: 32px 24px
    h1
      font-size: 32px
      margin-bottom: 8px
    h2
      font-size: 18px
      margin-top: 32px
      margin-bottom: 8px
      color: #888
