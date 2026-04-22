# AgentCanvas markdown-to-tiptap throughput corpus

A mix of constructs the real note/plan tiles produce. Intentionally repetitive
so the parser's hot paths get exercised.

## Headings and paragraphs

The **quick** brown _fox_ jumps over the ~~lazy~~ dog. Here is `inline code`
and a [link](https://example.com) and an image ![alt](https://x.y/img.png).

### Deeper heading

Short.

#### Four hashes

More paragraph text with **nested _italic inside bold_** and `code with
"quotes" and \backslashes\`. Em dashes — still text. Hard line break follows.\
New line.

## Lists

- first
- second with **bold**
- third
  - nested one
  - nested two
    - nested three
- fourth with `code` and [link](https://example.com)

1. ordered first
2. ordered second
   1. ordered nested
   2. ordered nested two
3. ordered third

- [ ] task incomplete
- [x] task complete
- [ ] task with **bold** inside and [link](https://x.com)
- [x] another done

## Code blocks

```ts
export function add(a: number, b: number): number {
  return a + b
}
```

```bash
curl -s -X POST http://127.0.0.1:7311/api/ping \
  -H 'Content-Type: application/json' \
  -d '{"hello":"world"}'
```

```
plain preformatted
  indented line
    deeper indent
```

## Tables

| key | value | notes |
|-----|-------|-------|
| alpha | 1 | primary |
| beta  | 2 | secondary |
| gamma | 3 | tertiary |
| delta | 4 | quaternary |

## Blockquote

> This is a blockquote.
> With multiple lines.
>
> > Nested quote layer.
> > More nested.

## Horizontal rule

---

## Repeated block (keeps the hot path warm)

Paragraph one with **bold** and _italic_ and `code` and [link](https://a.b).

Paragraph two with **bold** and _italic_ and `code` and [link](https://a.b).

Paragraph three with **bold** and _italic_ and `code` and [link](https://a.b).

Paragraph four with **bold** and _italic_ and `code` and [link](https://a.b).

Paragraph five with **bold** and _italic_ and `code` and [link](https://a.b).

- bullet with **bold** 1
- bullet with **bold** 2
- bullet with **bold** 3
- bullet with **bold** 4
- bullet with **bold** 5
- bullet with **bold** 6
- bullet with **bold** 7
- bullet with **bold** 8
- bullet with **bold** 9
- bullet with **bold** 10

```js
function quick(n) {
  let acc = 0
  for (let i = 0; i < n; i++) acc += i * 7 - (i % 3)
  return acc
}
console.log(quick(1000))
```

| header a | header b | header c | header d |
|----------|----------|----------|----------|
| row 1a | row 1b | row 1c | row 1d |
| row 2a | row 2b | row 2c | row 2d |
| row 3a | row 3b | row 3c | row 3d |
| row 4a | row 4b | row 4c | row 4d |
| row 5a | row 5b | row 5c | row 5d |

More prose. More prose. More prose. More prose. More prose. More prose.

## End

Final paragraph. Benchmark ends here.
