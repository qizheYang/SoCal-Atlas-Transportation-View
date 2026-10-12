# SoCal Atlas · Transportation View

## 当前范围（2026-10-12 后续确认）

用户确认扩展为完整十县 SoCal：LA、Orange、San Diego、Imperial、Riverside、San Bernardino、Ventura、Santa Barbara、San Luis Obispo、Kern。默认入口随范围扩展为 SoCal 北向 2D 全览，LA＋OC 保留快捷区域。名称为 SoCal Atlas · Transportation View。

此增量包含真实十县道路／边界重新导入，新增可用官方 GTFS（对归档与不可用机构明确标记），触摸板平移／捏合与鼠标模式、紧凑面板布局、多线路共线棋盘显示，以及本地 Git 仓库初始化。主要描述：Inspired by Cities: Skylines II, an interactive atlas of Southern California’s roads, highways, and public transportation. Explore connected corridors, city boundaries, and layered transport networks in 2D and 3D.

以下保留首版规划的历史范围，当前覆盖以 README 和数据 manifest 为准。

## 确认的产品范围

2026-10-12 用户确认：真实 Los Angeles / Orange County 数据的 2D 与倾斜 3D 查看器。参考 CSL2 的地图编辑器、道路与交通信息视图；第一版不修改真实道路、不运行交通模拟。项目位于 `map_csl2_style`。

## 研究先行

- 官方 Map Editor / Traffic AI / Public Transportation 开发日志与截图见 [视觉研究](csl2-references.md)。自然城市视图与淡色分析视图区分；深色半透明工作区、检查器和底部工具栏。
- [数据研究](data-sources.md)：OSM / OpenMapTiles / OpenFreeMap 提供道路、建筑轮廓、POI；官方 agency GTFS 提供公交与轨道交通线路和站点；公开 DEM 提供地形。
- MapLibre GL JS + React + TypeScript + Vite；以原始矢量图层自定义样式，地区配置和数据来源与 UI 解耦。

## 并行实施

1. 地图引擎：自然/道路/公共交通/地形模式，平移缩放旋转，2D/3D，分层，点选检查，来源状态。
2. 数据：下载并转换 Metro / OCTA / Metrolink GTFS 为本地 GeoJSON；保存下载时间、覆盖与 source metadata；提供可重复更新脚本。
3. 工作台：地区与预设地点、图层控制、线路筛选、地点/线路/站点本地搜索、选中对象检查、来源说明。
4. 集成：类型检查、生产构建、数据/状态测试、浏览器交互与画面验证。

## 首版验收

- 可在 LA 与 OC 浏览真实街网，放大看到普通建筑与 POI。
- 道路、高速、建筑、POI、公交/轨道、标签可分别控制。
- 道路与交通模式改变实际地图样式，点选显示真实可用字段。
- 官方 GTFS 线路与站点可浏览、筛选；静态网络不冒充实时运营数据。
- 3D 建筑注明是挤出近似，缺字段明确标示未知；无虚构车道、车流和拥堵数字。
- 所有 provider 网络失败可见；保留 attribution；增加地区无需重写地图核心。

## 道路目录增量（2026-10-12）

用户要求高速与普通道路具备类似公共交通的线路筛选，并区分同名道路、完整列出跨城道路沿线城市。并行实施：Census 全县道路预处理、Census 城市／CDP／非建制地区边界、MapLibre 全线路与边界叠加、名称／类别／城市目录 UI。使用真实 polygon 相交，不按最近城市或当前瓦片推断。自动检查道路连通性、同名异地、跨城归属及搜索；浏览器验收 I-405、Santa Monica Blvd 与 Main St。

## 多重高亮与单条详情

追加确认：允许 I-5、I-10 与 A-Line 等跨类别多重高亮；每条可聚焦、移除，集合可一键清空和全览。模式、区域及机构浏览切换保留已选集合。单条详情显示真实长度定义、道路开放端点或 GTFS 首末站组合，并可点击定位。端点从来源几何／站序计算，不猜测行驶方向或把所有分支叠加成单程。

## 之后的扩展方向

扩大区域 registry；按地区使用 PMTiles 自托管以减少第三方依赖；Overture 或地方建筑数据补齐形体；有授权后加入 geocoder、GTFS-RT 与交通速度；独立规划草图层。首版的常用地点是导航书签，不充当完整 POI 数据库。
