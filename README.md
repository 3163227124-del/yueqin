# 北京游戏厅约勤

一个用于游戏厅双人约勤场景的北京通勤推荐工具。两个人各输入起点，工具会从北京游戏厅候选中优先计算真实路线，并按公平优先的通勤体验给出推荐。

候选地点来自 BEMANICN 街机地图，高德地图负责地点搜索、地图展示和路线规划。

## 功能

- 北京 111 家 BEMANICN 店铺数据，全部预先补全高德坐标。
- 两个人起点搜索，支持公交、驾车、步行路线。
- 推荐排序公平优先：先压低双方最大通勤时间和时间差，再考虑平均时间。
- 推荐卡展示双方用时，hover 可查看具体分段路径。
- 公交路径如果包含高德返回的打车段，会显示 `含打车` 方便人工校验。
- 每家店保留全国音游地图单点页链接，例如 `https://map.bemanicn.com/s/1615`。

## 快速启动

需要 Node.js 20 或更新版本。

```bash
npm start
```

打开：

```text
http://127.0.0.1:5173
```

页面打开后输入高德 API key 并点击“连接”。

也可以用环境变量启动：

```bash
AMAP_KEY=你的key npm start
```

地图 JS 仍需要浏览器侧 key；本地代理会把服务端路线 key 保存在当前进程内存，不会写入项目文件。

## 配置

可以参考 `.env.example`：

```bash
HOST=127.0.0.1
PORT=5173
AMAP_KEY=
AMAP_MIN_DELAY_MS=120
```

当前项目不自动读取 `.env` 文件；如果使用 `.env`，请用 shell 工具自行加载。`.env` 默认不会提交。

## 常用命令

```bash
npm start          # 启动本地服务
npm test           # 跑单元测试
npm run check      # 语法、数据和测试全量检查
npm run extract:data
npm run geocode:data
```

## 数据维护

北京店铺列表来自：

```text
https://map.bemanicn.com/region/city/110100000000
```

更新流程：

1. 保存 BEMANICN 北京城市页到 `work/bemanicn-beijing.html`。
2. 运行 `npm run extract:data` 生成店铺列表。
3. 运行 `AMAP_KEY=你的key npm run geocode:data` 补全高德坐标。
4. 运行 `npm run check` 确认数据完整。

高德地理编码偶尔会误匹配。人工确认的 POI 修正写在 `data/geocode-overrides.json`，预处理脚本会优先使用这些结果。

## 项目文档

- `docs/ARCHITECTURE.md`：架构和 API。
- `docs/DATA.md`：数据字段和质量控制。
- `docs/ROADMAP.md`：后续路线图。
- `SECURITY.md`：key 和公开部署注意事项。
- `CONTRIBUTING.md`：贡献和数据更新流程。

## 重要限制

- 首版只覆盖北京。
- BEMANICN 城市页提供店铺列表，但不提供完整机台详情；机种筛选需要后续接入更细数据源。
- 正式公网部署前，应把高德 Web 服务 key 放在后端，并配置限流。
