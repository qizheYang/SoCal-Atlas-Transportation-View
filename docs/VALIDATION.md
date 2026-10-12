# 验收记录

日期：2026-10-12；本地开发地址：`http://127.0.0.1:5177/`。

## 初版自动检查

- `npm test`：8 项通过。使用 MapLibre 官方 style validator 检查四种模式、2D / 3D、地形，执行 transit agency / route / stop membership 过滤、POI rank / zoom 显示规则，并检查稀疏建筑与道路属性。
- `python3 -m unittest discover -s scripts -p 'test_*.py'`：7 项通过。覆盖 GTFS 顺序、形状去重、parent station、Metrolink 适配、外键错误，以及随项目提供的完整数据快照。
- 快照检查：186 个唯一机构路线 ID；17,153 个机构站点记录；全部站点路线引用可解析；manifest 的机构统计、bounds、颜色、名称、类型与 GeoJSON 一致。
- `npm run build`：TypeScript 与 Vite 生产构建通过。MapLibre 引擎使主 bundle 超过 Vite 默认 500 KB 提示阈值，属于体积提示，不是构建失败。

## 实际浏览器检查

通过 Computer Use 在 macOS Safari 中操作、读取界面并检查实际截图；没有用 mock 底图替代真实瓦片。

- 洛杉矶 Downtown 初始 3D 城市场景：真实街网、建筑挤出、POI 与 provider attribution 已加载。
- 图层面板：关闭公共交通，实际线路和对应站点隐藏，图层计数更新。
- 道路分析视图：淡色建筑、分级道路颜色与图例变化。
- 2D / 3D：倾斜建筑视图与平面建筑轮廓切换。
- 地图点击：命中建筑并打开带坐标与来源的检查器；随后修正了 map 输出字段到面板显示字段的映射，类型检查通过。
- 交通目录：显示 186 条线路；选择 Metro E Line，机构切到 Metro Rail，地图只聚焦该线路，检查器保持显示，底图随后加载完成。
- 来源弹窗：显示四份 feed 的实际计数和抓取日期，披露 OCTA 排除记录；Shift+Tab 从关闭按钮回绕到最后链接；Escape 关闭弹窗并保留地图的线路检查器。
- 本地搜索 `Irvine`：返回目的地、OCTA 线路与相关站名；点选目的地将区域切到 Orange County，飞往 Irvine。检查实际截图中的道路、普通住宅和办公建筑轮廓。
- OC 地形模式：已看到 Laguna Coast / Shady Canyon / Turtle Rock 附近真实山脊起伏、海岸与道路，3D terrain 正常加载。

## 道路目录、多重高亮与详情增量

- 自动检查：`npm test` 31 项通过（地图样式、多道路颜色与城市集合、跨机构 transit routeIds、精确编号／全称道路搜索、城市筛选保留完整路段、几何分片选择）；TypeScript 与生产构建通过。`.venv-data/bin/python -m unittest discover -s scripts -p 'test_*.py'` 39 项通过，包含道路连通和方向词名保护、编号规范化、边界分区、拓扑端点、GTFS 首末站与形状测长。
- 两县道路目录由真实 Census 县级 All Roads 数据生成；全量校验唯一 ID、每个索引到分片的引用、城市外键、坐标和 gzip 解压一致性。地区字段不使用 nearest-city 推断。
- 最终快照重载显示 113,315 个道路候选。48 条编号道路逐条对照原始两县 LINEARID 集合，确认名称变体归并完整；236,080 个端点均对应真实源几何顶点。
- Chrome 实际验收 I-405：完整线路聚焦、21 个沿线地区、边界／标签／交界点、isolated/context 与 2D 切换。Santa Monica Boulevard 全称搜索返回真实 Santa Monica Blvd，详情列出 LA、West Hollywood、Beverly Hills、Santa Monica，地图显示城市交界名称。
- Chrome 全局 Main Street 搜索显示不同城市的同名候选；“打开道路目录”保留查询条件。
- Safari 实际验收混合添加 I-5、I-10、Metro A Line：底部列表为三项，地图分别呈现青色 I-5、橙色 I-10、蓝色 A-Line；“查看全部”聚焦它们的合并范围。
- Safari I-5 与 I-10 详情显示源道路总长、全部途经地区、多个地理端点及可展开的其余端点；A-Line 显示约 93.0 km、2 个源形状、21 组首末站，首项 Pomona North → Downtown Long Beach。点击 Pomona North 后实际相机到达约 34.0940 N / 117.7522 W、zoom 16。
- Safari 移除 I-10 后保留 I-5 和 A-Line 两项；切换到城市视图仍保留两项；将交通浏览机构改为 OCTA，已选的 A-Line 与 I-5 仍保留。清空全部后高亮列表、详情和所选城市边界移除，回到机构网络浏览。异步中止行为另有代码审阅，未进行慢网络故障注入。
- Safari 最终快照搜索 Wilshire Boulevard 返回一个完整候选；详情显示 27.1 km、4 个城市／地区、两个端点。点击 Santa Monica 端点后相机到达 34.0168 N / 118.5012 W、zoom 16，截图确认真实街网与建筑加载。

## SoCal、触摸板与棋盘显示增量

- 范围：用户确认完整十县；道路目录 293,079 项，其中 149 条编号公路逐条通过原始 LINEARID 集合哈希与记录数核对。全量 256 几何分片、城市外键及 605,387 个端点顶点位置检查通过。
- 边界：235 城市、328 CDP、10 县残余区域；573 个 polygon 有效，各县分区联合与县域差为 0 平方米，没有大于 1 平方米的分区重叠。导航 JSON 同源生成。
- 公交：15 个 feed 组、537 条路线、29,991 个机构站点、1,835 组首末站。全部路线详情及源 ZIP SHA 与 manifest 一致。RTA 使用标记日期归档；NCTD 是已记录的缺口。
- GIS/GTFS：49 项 Python 测试通过。压缩数据还原：3 项 Node 测试通过，真实快照重复校验 257 文件、313.5 MB raw，0 个文件被不必要地重写。
- 前端 78 项测试全部通过：默认入口忽略旧近景／倾斜偏好；wheel 平移、Ctrl-wheel 捏合、Safari gesture 双流去重、清理生命周期；二至五路共享区间及 N 色像素；worker 中止／迟到结果；MapLibre 样式和叠放顺序；高亮颜色预约、去重和稳定性。TypeScript 检查及生产构建通过。
- 实际 Chrome：观察到 SoCal 区域默认 2D 全览，缩放 Z6.4；普通滚动改变中心位置但 zoom 保持 6.4。输入设备按钮可切到鼠标并更新提示；紧凑顶栏、右侧导航、折叠图例已观察截图。
- Safari 预览恢复后，实际选择 A Line 与 E Line，点击 Historic Broadway 首末站定位至 Z16；截图确认共享区间连续显示蓝黄棋盘，两个高亮同时保留。三路、四路及更多成员由几何与纹理测试覆盖，未逐组实机截图。
- Safari 实际选择原色相同的 Metro 10/48 与 102：前者保持橙色、后者分配青色，地图与高亮列表颜色一致，详情出现独立对比色说明。
- Safari 较窄窗口中，打开详情自动收起工作区；详情与导航上下排列，两个高亮和底部视图切换可见。默认 SoCal 全览为北向 2D，窗口尺寸不同导致 fitBounds 缩放不同（此窗口为 Z5.0）。实体触摸板捏合和真机手机仍未验证。
- 本地 HTTP 入口可达，返回 SoCal Atlas 标题与项目描述。Git 仓库为本地 main；GitHub CLI 通过真实 API 验证当前登录 qizheYang，尚未创建远程仓库。

## 证据边界

已验收主要桌面交互。响应式 CSS 与触屏 MapLibre 交互已提供，但尚未做真机手机测试；没有对每个街区逐一核对 OSM 完整性。未进行长期性能压测、断网/慢网故障注入、生产部署或跨浏览器全矩阵测试。真实来源正常加载不代表提供方未来持续可用。

静态 GTFS 网络不代表今天每条线路都在运行；建筑高度不保证实测；没有实时车流、车道级网络、实时到站或路由规划。详细数据版本与已知缺口见 `public/data/transit-manifest.json` 和 [数据来源](data-sources.md)。
