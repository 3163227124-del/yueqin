# 数据说明

## 来源

店铺列表来自 BEMANICN 街机地图城市页。当前覆盖北京、上海、广州、深圳，例如北京：

`https://map.bemanicn.com/region/city/110100000000`

每个店铺保留单点页链接，例如：

`https://map.bemanicn.com/s/1615`

## 字段

- `id`：BEMANICN 店铺 ID。
- `name`：店铺名称。
- `address`：BEMANICN 地址。
- `geocodeAddress`：用于高德地理编码的规范化地址。
- `countyCode` / `countyName`：城市下属区县。
- `status`：`open`、`closed`、`upcoming`。
- `location`：高德经纬度。
- `geocode`：高德地理编码或人工确认 POI 的匹配结果。
- `sourceUrl`：BEMANICN 单点页。

## 质量控制

运行：

```bash
npm run check
```

会验证店铺 ID 唯一、坐标完整、来源链接正确、地理编码区县匹配。

个别高德地理编码误匹配但 POI 搜索能确认的店铺，记录在 `data/geocode-overrides.json`。
