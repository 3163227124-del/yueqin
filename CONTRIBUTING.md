# 贡献指南

## 本地检查

提交前运行：

```bash
npm run check
```

## 数据修改

更新 BEMANICN 页面数据后，先运行：

```bash
npm run extract:data
```

再用高德 key 补坐标：

```bash
AMAP_KEY=你的key npm run geocode:data
```

如果高德地理编码误匹配，但 POI 搜索有精确结果，把人工确认结果写入 `data/geocode-overrides.json`。

## 代码风格

- 不引入构建链，除非它明显降低维护成本。
- 路线推荐最终分数只基于真实路线结果。
- 直线距离和区县中心点只能用于调度优先级，不能作为最终通勤时间。
