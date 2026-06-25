# 音乐 App — 网易云音乐接入说明

## 架构

```
用户浏览器 (GitHub Pages 静态前端)
   │  POST /netease/{search,song/url,lyric,...}
   │  Header: X-Netease-Cookie: MUSIC_U=xxx
   ▼
moro-n Worker (Cloudflare Workers, 国内可访问, 免费)
   │  转成 api-enhanced 标准 GET 请求, 加 realIP
   ▼
api-enhanced (部署在 Vercel, 免费 Hobby 计划)
   │  处理加密/协议适配, 转发到网易云
   ▼
music.163.com
```

**重点**: 用户只接触 GitHub Pages + CF Worker, **根本不会直连 Vercel**。Vercel 是 Worker 自己去调的,所以国内用户没有墙的问题。

## 一次性部署 (作者/管理员做)

### 第一步:把 api-enhanced 部署到 Vercel

1. 打开 <https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced>
2. 右上角 Fork 一份到你自己账号下
3. 打开 <https://vercel.com/new> → 选 "Import Git Repository"
4. 选你刚 Fork 的那个 `api-enhanced`
5. 直接 Deploy (不用改任何设置)
6. 部署完成后得到一个形如 `https://api-enhanced-xxxx.vercel.app` 的地址 → 复制它

### 第二步:改 Worker

打开 `worker/index.js`,找到开头附近这一行:

```js
const NETEASE_API_BASE = "https://请把这行改成你的vercel地址.vercel.app";
```

替换成你刚才 Vercel 给你的地址,保存,重新部署 Worker。

### 第三步:验证

打开音乐 App → 右上齿轮 → "一键诊断(搜索晴天)",应该看到:
- `HTTP 200`
- `code=200`
- `songs=3`

## 用户侧使用

1. 打开音乐 App → 右上齿轮
2. 粘贴 `MUSIC_U=xxx` (从 music.163.com 的 Cookie 里复制)
3. 保存 → 搜歌 → 播放

## 为什么这样架构

### 为什么不直接在 Worker 里实现网易云加密

试过了,自己写 weapi 加密算法能跑通,但网易云 2024 年后对部分接口改了响应,会返回一个 `{"result":"<hex>"}` 的加密响应,得解密才能用。`api-enhanced` 一直在跟进这些协议变化, 自己造轮子追不上。用它省心。

### 为什么 Vercel 不会乱扣钱

Vercel 的 Hobby 免费计划:
- 100 GB 流量/月
- 100 万 Edge 请求/月
- 超了**会停服但不会自动收费**(需要用户主动升级到付费计划才能收费)

和 Netlify 的付费带信用卡绑定模式**不一样**。

### 为什么不让用户自己部署 api-enhanced

5000 用户大部分不会部署。由管理员统一部署一份,用户共享,才是可行路径。如果有能力的用户想自建,只需要 fork api-enhanced 到自己 Vercel,把得到的 URL 填进 App 设置里的 "后端 Worker 地址"... 等等,这里要说明:目前 App 设置里填的是 Worker URL,不是 Vercel URL。想换也可以,但正常用户不需要折腾。

## API 接口(前端 → Worker)

所有都是 `POST application/json`,Header `X-Netease-Cookie: MUSIC_U=xxx`(可选)。Worker 会自动转成 GET 转发给 Vercel 上的 api-enhanced。

| 路径 | Body | 说明 |
|------|------|------|
| `/netease/search` | `{ keyword, limit?, offset? }` | 搜索单曲 |
| `/netease/song/url` | `{ ids:[id], level? }` | 播放链接 |
| `/netease/lyric` | `{ id }` | 歌词 |
| `/netease/song/detail` | `{ ids:[id] }` | 歌曲详情 |
| `/netease/login/status` | `{}` | 当前 cookie 登录状态 |
| `/netease/user/playlist` | `{ uid }` | 用户歌单 |
| `/netease/playlist/detail` | `{ id }` | 歌单详情 |
| `/netease/comment/music` | `{ id, limit?, offset? }` | 歌曲评论（热评 + 最新） |

## 评论区 · 乐评（陪伴感核心）

对标网易云最有陪伴感的「评论区」，但把它和角色绑在一起 —— 听歌时不再一个人。
入口：播放页底部「评论」按钮；播放页还会让最新一条角色乐评「探头」出来，点开即进。

三层声音（`apps/music/SongCommentsPage.tsx`）：
1. **TA 的乐评** —— 点角色头像，让 TA 给这首歌写一条第一人称乐评（副 API）。落到
   `char.musicProfile.reviews`（`targetType:'song'`），拜访页「写过的话」也能回看。
2. **网易云热评 / 最新** —— 真实社区评论，走 `/netease/comment/music`（本地「一起写的歌」自动跳过）。
3. **我说的话** —— 你写一句，正在「一起听」的角色自动盖楼回你；也可手动点头像让某个角色接话。
   你的留言 + 角色回复落 localStorage（`moro_music_user_comments_v1`，按 songId 分桶）。

逻辑都在 `utils/musicComments.ts`：`fetchSongComments` / `generateCharComment` /
`generateCharReply` + 本地留言/点赞存储。评论的 prompt 文案就放在该文件里（和
`utils/listenTogether.ts` 一样，属音乐 App 局部 prompt，不进 `laiwangPrompts.ts`）。
