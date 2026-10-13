# SoCal Atlas · Transportation View

**Inspired by Cities: Skylines II, an interactive atlas of Southern California’s roads, highways, and public transportation. Explore connected corridors, city boundaries, and layered transport networks in 2D and 3D.**

以开放地理数据和官方交通数据构建的南加州交通地图工作台。保留 CSL2 地图编辑器和信息视图的视觉启发，提供真实区域浏览、跨城道路检索、多线路比较与单条详情。

**在线地图：[rehydratedwater.com/socalmap](https://rehydratedwater.com/socalmap/)**

GitHub Actions 对 PR 和 `main` 执行检查；`main` 通过后自动构建 `/socalmap/` 版本并部署到 DigitalOcean。发布采用独立账号、固定主机密钥和原子版本切换。配置、验证和回滚见 [部署说明](docs/deployment.md)。

## 启动

需要 Node.js 22.12+。项目包含可直接使用的数据快照。

```bash
npm ci --legacy-peer-deps
npm run dev
```

打开 <http://127.0.0.1:5177/>。`predev` 会使用 Node 内置 zlib 从仓库中的 gzip 快照还原道路原始 JSON；不需要重新下载 GIS 数据。后续启动会校验并复用相同文件。首次安装的 `--legacy-peer-deps` 用于规避当前 npm 10 的可选 peer 解析问题，依赖版本由 lockfile 固定。

## 浏览与操作

- 每次进入均显示 **SoCal 全览、北朝上、2D**。区域菜单可切换十个县或 LA＋OC；右侧 SoCal 按钮回到全览。
- **触摸板模式**：双指滑动平移，捏合缩放；**鼠标模式**：拖动平移、滚轮缩放。界面有缩放、左右旋转、N 恢复北向和 2D／3D 按钮。
- 城市、道路、公共交通、地形四种视图；可控制建筑、道路、POI、轨道、交通和标签等图层。
- 搜索道路名称／编号、精选城市、公交／铁路线路或站名。支持 `I-5`、`Main Street`、`Santa Monica Boulevard` 等全称和缩写；同名道路显示城市，城市筛选保留完整跨城道路。
- I-5、I-10、A-Line 等可同时高亮，分别聚焦／移除，也可全览／清空。真正共线的段落采用双色或多色棋盘纹理；普通交叉不作共线处理。
- 道路详情显示源几何总长、途经城市与可点击的开放端点；交通详情显示单个形状的长度范围及不同方向／区间的首末站。
- 列表与详情可滚动，图例按需展开；较窄视口中打开详情会收起工作区，为地图留出空间。关闭详情保留已选高亮。

输入设备和部分图层偏好保存在本机浏览器。每次进入重置为区域城市全览，并开启标签、关闭公共交通与地形覆盖以保持清晰。没有上传用户选择到服务端。

## 地理范围与数据

完整 **10 县**：Los Angeles、Orange、San Diego、Imperial、Riverside、San Bernardino、Ventura、Santa Barbara、San Luis Obispo、Kern。县域 bounds 与行政区归属取自相同的 Census 边界，含县属离岛。

| 内容 | 实际来源与覆盖 |
| --- | --- |
| 基础街网、普通建筑、POI、土地利用 | OpenStreetMap → OpenMapTiles → OpenFreeMap 在线矢量瓦片 |
| 可搜索道路 | Census TIGER/Line 2025：293,079 个候选，含 149 条完整归并的编号公路 |
| 城市／地区边界 | Census TIGERweb 2026-01-01：235 城市、328 CDP、10 个县剩余非建制地区 |
| 公共交通 | 15 个 GTFS feed 组、537 条线路、29,991 个机构站点记录 |
| 线路详情 | 537 条线路、1,835 组首末站组合 |
| 地形 | Mapterhorn DEM、hillshade 与三维地表 |

交通包括 LA Metro、OCTA、Metrolink、San Diego MTS、Riverside Transit Agency、Omnitrans、SunLine、Imperial Valley Transit、Kern Transit、Golden Empire Transit、Santa Barbara MTD、SLO Regional Transit、SLO Transit 与 Ventura 县聚合 feed。聚合 feed 中保留各实际运营商，因此 feed 组数不等同于独立运营商数。

**交通覆盖仍有缺口。** NCTD 公开入口本次无法下载，COASTER、SPRINTER、BREEZE 未收录；其他市政公交、Amtrak 和部分乡村服务也未全部接入。RTA 使用明确标记的 **2026-09-14 官方 GTFS 归档**，其余快照的实际来源、时间、哈希和遗漏记录均保存在 manifest。地图中的来源面板会显示归档与覆盖说明。详见 [来源研究](docs/data-sources.md)。

道路候选按名称和几何连通性归组，普通道路采用 20m 容差，但不绘制虚构连接线；同一编号在十县的所有源段归为一项。道路长度包含分隔车道及分支，**不是单向驾车里程**。端点是数据范围内的开放几何端部，不是假定的全国道路起终点。城市关系使用实际 polygon 相交。详见 [道路数据](docs/road-data-sources.md)、[道路详情](docs/road-details.md)、[公共交通详情](docs/transit-details.md)。

共线显示采用保守的 2m 几何容差，并检测方向与连续共享长度；不会据此推断同一交通设施。来源位置差异较大的线路可能不形成棋盘段。详见 [重合显示](docs/overlaps.md)。

## 数据更新与扩展

普通使用无需 Python。重新生成数据需要 Python 3；GIS 导入需安装固定依赖：

```bash
python3 -m venv .venv-data
.venv-data/bin/pip install -r scripts/requirements-data.txt
npm run data:boundaries
npm run data:roads
npm run data:transit
```

默认 GIS scope 为 `socal-ten`。其他范围可通过导入器 `--scope`／`--counties` 配置，边界与道路范围必须一致。机构配置位于 `scripts/import_gtfs.py`；GTFS 缓存复用规则及归档更新注意事项见来源文档。地区导航配置由边界导入器生成，精选地点位于 `src/data/regions.ts`。

道路目录 gzip 约 **13.1 MB**，256 个几何 gzip 分片合计约 **33.0 MB**；目录首次搜索时加载，形状按选择加载并缓存。仓库保留压缩快照，约 313.5 MB 的原始 JSON 是被 Git 忽略的还原产物。`predev`、`prebuild`、`prepreview` 自动校验还原；也可单独运行 `npm run data:materialize`。浏览器优先解压 gzip，并有原始 JSON 回退。

## 验证

```bash
npm test
node --test scripts/test_materialize_road_data.mjs
.venv-data/bin/python -m unittest discover -s scripts -p 'test_*.py'
npm run build
npm run preview
```

检查记录与实际浏览器证据见 [VALIDATION.md](docs/VALIDATION.md)。MapLibre 引擎使生产包触发 Vite 的体积提示，构建可正常完成。底图和地形需要网络及 WebGL；公开提供方不附带本项目的可用性保证。

没有实时车流、到站预测、路由规划、真实道路编辑或 CSL2 存档导入。建筑高度可能是估计值，OSM 建筑和 POI 的覆盖并不保证完整；GTFS 静态排班不是当日运营保证。

## 项目文档

- [实施计划与范围演进](docs/PLAN.md)
- [CSL2 视觉与交互研究](docs/csl2-references.md)
- [架构](docs/architecture.md)
- [触摸板与相机交互](docs/navigation.md)

自有源码采用 [MIT License](LICENSE)。OSM 数据适用 ODbL；其他公开 GIS、GTFS 数据和依赖保留各自许可与使用条款。独立项目，与 Cities: Skylines II 发行方无关联。
