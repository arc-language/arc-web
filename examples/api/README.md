# Arc API Example

A simple REST API built with Arc's backend language features.

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/posts` | List all posts |
| `GET` | `/posts/:id` | Get a post by ID |
| `POST` | `/posts` | Create a post |
| `DELETE` | `/posts/:id` | Delete a post |
| `GET` | `/health` | Health check |

## Run

```bash
# Build + start server (requires bun)
arc serve .

# Or build only
arc build-server .
bun dist/server.js
```

## Structure

```
server/
  schemas/
    post.arc      # schema Post { id, title, body, published, createdAt }
  routes/
    posts.arc     # GET/POST/DELETE /posts, GET /posts/:id
  jobs/
    notify.arc    # job NotifySubscribers(postId: Int)
```

## Performance

- Routes compiled to a radix-trie decision tree (zero regex at request time)
- SQL queries compiled to constant strings (no query-builder overhead)
- Runs on Bun (~5.6M req/s hello world, ~350K req/s CRUD with SQLite)
