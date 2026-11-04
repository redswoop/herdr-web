# Kitchen sink

A single reply that leans on every bit of markup the transcript might meet. Some of it the parser handles today, some it doesn't yet (lists, quotes, rules, strikethrough): the point is to see both engines on the same input.

## Inline

Plain, **bold**, *italic*, ***bold italic***, `inline code`, **bold with `code` and *em* inside**, ~~strikethrough~~, a [link](https://example.com/path?q=1), a bare URL https://github.com/redswoop/herdr-web, a path `web/src/webview/main.tsx:42`, a home path `~/.config/herdr/agent-detection/grok.toml`, and a bare absolute path /home/armen/src/herdr-web/PLAN-HTML-TRANSCRIPT.md in prose.

Underscores_inside_words_stay, snake_case_name, 2*3*4 is not emphasis, and a lone * asterisk.

A very long unbroken token to test wrapping: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

### Lists

- first bullet
- second bullet with **bold** and `code`
  - nested bullet
  - another nested
    - third level
- fourth bullet that is long enough to wrap on a phone screen at a large text size so we can see how the hanging indent behaves

1. numbered one
2. numbered two
   1. nested numbered
   2. nested numbered two
3. numbered three

- [ ] task not done
- [x] task done

> A blockquote with **bold** and a second line
> that continues the quote.

---

#### Small table

| key | value |
| --- | --- |
| alpha | 1 |
| beta | 22 |

#### Aligned table

| left | center | right |
| :--- | :---: | ---: |
| a | b | c |
| longer text here | mid | 1,234.56 |

#### Wide table (should scroll sideways, not squash)

| id | host | status | model | effort | context | tokens | elapsed | cwd | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| w3K:pK | stormer | working | claude-fable-5-1 | high | 149k | 20k | 3m 30s | ~/src/herdr-web | the pane this fixture was written in |
| w3H:pB | stormer | idle | claude-opus-5-5 | medium | 78k | 2.5k | 44s | ~/src/bambu-preview | **bold in a cell** and `code in a cell` |
| w2Y:p3 | blackstar | done | claude-sonnet-5-5 | low | 12k | 800 | 9s | ~/dev/emmy | a [link](https://example.com) in a cell |

#### Long table (60 rows)

| n | square | cube | word |
| --- | --- | --- | --- |
| 1 | 1 | 1 | one |
| 2 | 4 | 8 | two |
| 3 | 9 | 27 | three |
| 4 | 16 | 64 | four |
| 5 | 25 | 125 | five |
| 6 | 36 | 216 | six |
| 7 | 49 | 343 | seven |
| 8 | 64 | 512 | eight |
| 9 | 81 | 729 | nine |
| 10 | 100 | 1000 | ten |
| 11 | 121 | 1331 | eleven |
| 12 | 144 | 1728 | twelve |
| 13 | 169 | 2197 | thirteen |
| 14 | 196 | 2744 | fourteen |
| 15 | 225 | 3375 | fifteen |
| 16 | 256 | 4096 | sixteen |
| 17 | 289 | 4913 | seventeen |
| 18 | 324 | 5832 | eighteen |
| 19 | 361 | 6859 | nineteen |
| 20 | 400 | 8000 | twenty |
| 21 | 441 | 9261 | twenty-one |
| 22 | 484 | 10648 | twenty-two |
| 23 | 529 | 12167 | twenty-three |
| 24 | 576 | 13824 | twenty-four |
| 25 | 625 | 15625 | twenty-five |
| 26 | 676 | 17576 | twenty-six |
| 27 | 729 | 19683 | twenty-seven |
| 28 | 784 | 21952 | twenty-eight |
| 29 | 841 | 24389 | twenty-nine |
| 30 | 900 | 27000 | thirty |
| 31 | 961 | 29791 | thirty-one |
| 32 | 1024 | 32768 | thirty-two |
| 33 | 1089 | 35937 | thirty-three |
| 34 | 1156 | 39304 | thirty-four |
| 35 | 1225 | 42875 | thirty-five |
| 36 | 1296 | 46656 | thirty-six |
| 37 | 1369 | 50653 | thirty-seven |
| 38 | 1444 | 54872 | thirty-eight |
| 39 | 1521 | 59319 | thirty-nine |
| 40 | 1600 | 64000 | forty |
| 41 | 1681 | 68921 | forty-one |
| 42 | 1764 | 74088 | forty-two |
| 43 | 1849 | 79507 | forty-three |
| 44 | 1936 | 85184 | forty-four |
| 45 | 2025 | 91125 | forty-five |
| 46 | 2116 | 97336 | forty-six |
| 47 | 2209 | 103823 | forty-seven |
| 48 | 2304 | 110592 | forty-eight |
| 49 | 2401 | 117649 | forty-nine |
| 50 | 2500 | 125000 | fifty |
| 51 | 2601 | 132651 | fifty-one |
| 52 | 2704 | 140608 | fifty-two |
| 53 | 2809 | 148877 | fifty-three |
| 54 | 2916 | 157464 | fifty-four |
| 55 | 3025 | 166375 | fifty-five |
| 56 | 3136 | 175616 | fifty-six |
| 57 | 3249 | 185193 | fifty-seven |
| 58 | 3364 | 195112 | fifty-eight |
| 59 | 3481 | 205379 | fifty-nine |
| 60 | 3600 | 216000 | sixty |

### Code

```ts
// a fence with a language tag, a URL inside, and a long line
export function apiUrl(path: string, host?: string | null): string {
  const url = `https://stormer.tail93d23c.ts.net:7683${path}`; // https://example.com/docs
  return url + '?token=' + encodeURIComponent('a-very-long-token-value-that-will-not-fit-on-a-phone-screen-without-scrolling-sideways');
}
```

```
no language tag
  indented
    more indented
```

```bash
$ gaffer run --title "what this is" -- ./gradlew :app:assembleDebug
#371 queued  Capra Android debug build, third try
```

### Images

An image on its own line (a transcript shows this as a chip, the file viewer shows the picture):

![the goat](/home/armen/src/herdr-web/mobile/assets/brand/goat-src.jpg)

And an image inline in a sentence ![tiny](/home/armen/src/herdr-web/e2e/fixtures/pic.jpg) which is not the block form.

### Headings at every level

# H1
## H2
### H3
#### H4
##### H5
###### H6

### Whitespace and breaks

Line one of a paragraph
line two after a single newline
line three.

Trailing two spaces  
force a break here.

Last paragraph, with a unicode run: — – … “quotes” ‘single’ → ← ≠ ∞ 🐑 🐐 ✅ and some CJK 日本語テキスト and Arabic نص عربي and emoji flags 🇺🇸🇯🇵.
