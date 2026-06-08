# 架构说明

这个项目是一个本地优先的 Web 工具，由静态前端和轻量 Node 代理组成。

## 数据流

1. `scripts/extract-bemanicn.js` 从保存的 BEMANICN 城市页解析店铺列表。
2. `scripts/geocode-shops.js` 使用高德地理编码预先补全店铺坐标，并写回 `data/shops.{city}.json`。
3. 浏览器加载 `public/` 前端，展示地图、起点输入、候选店铺和推荐列表。
4. `server.js` 提供本地 API，负责高德 key 的运行时保存、输入提示、路线请求和缓存。
5. 推荐排序只使用高德真实路线时间；直线距离只用于决定先计算哪些候选。

## 关键接口

- `GET /api/config`：城市列表、当前城市、店铺数量、key 状态。
- `POST /api/key`：把高德 key 写入当前服务进程内存。
- `GET /api/shops`：读取预处理后的当前城市店铺数据。
- `GET /api/tips`：高德输入提示代理。
- `POST /api/geocode`：高德地理编码代理，主要用于起点和数据维护。
- `POST /api/route`：高德公交、驾车、步行路线代理。

## 缓存

运行时缓存写入 `work/amap-cache.json`，不建议提交。路线缓存 key 包含 schema 版本，路线结构变化时会自动避开旧缓存。

## 隐私

用户输入的起点和路线请求只发送给本地服务与高德 API。高德 key 可以在页面运行时输入，也可以用 `AMAP_KEY` 环境变量提供；项目不会把 key 写入代码或数据文件。
