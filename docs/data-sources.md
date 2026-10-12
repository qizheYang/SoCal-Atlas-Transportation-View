# Southern California 数据来源与扩展路径

调研和端点验证：2026-10-12。当前采用 MapLibre + OpenFreeMap 矢量底图，以及本地生成的官方 GTFS 公交/铁路图层。所有路线采用源文件实际 geometry；普通建筑和 POI 来自 OSM 矢量瓦片。数据可用不代表属性完整，也不等于实时运营状态。

## 已选来源

| 内容 | 第一版来源 | 接入方式 | 限制 |
| --- | --- | --- | --- |
| 道路、高速、匝道、桥隧、铁路底图 | OpenStreetMap 经 OpenFreeMap / OpenMapTiles | 客户端矢量瓦片 | 无实时车流；瓦片不含完整 OSM tags |
| 普通建筑 | 同上 `building` layer | 真实 footprint + approximate extrusion | 高度可能来自楼层推算或源默认值；不是测绘级 3D 模型 |
| POI | 同上 `poi` layer | 按类别过滤、显示名称 | OSM 覆盖和分类不完整，不承诺商户营业状态 |
| LA Metro Rail / Bus | LA Metro 官方 GTFS | 构建时 ZIP → 本地 GeoJSON | 展示排班网络，不是实时车辆位置 |
| OC Bus | OCTA 官方 GTFS | 同上 | 省略无 trip 的三条路线记录；忽略六个无效 shape pattern |
| 区域铁路 | Metrolink 官方 GTFS | 同上 | 保留跨县线路；实时 API 需要另行申请 key |
| 山地地形 | Mapterhorn | `raster-dem`，Terrarium encoding | 原始 DEM 分辨率与年代随区域变化 |

## 底图：OpenFreeMap / OpenMapTiles / OSM

- [OpenFreeMap 项目](https://openfreemap.org/)公开实例无需注册或 API key，声明不限制请求数，支持自托管。
- [官方 quick start](https://openfreemap.org/quick_start/)支持 MapLibre、自定义 style JSON、字体和图标资源。
- TileJSON：`https://tiles.openfreemap.org/planet/latest`。本次 HTTP 200 / `Access-Control-Allow-Origin: *`，实际瓦片版本为 `20261004_113936_pt`，数据 zoom 0–14；客户端可 overzoom。
- Glyphs：`https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`。
- [OpenMapTiles schema](https://openmaptiles.org/docs/schema/)及实际 TileJSON 一致：建筑 `render_height`、`render_min_height`、`hide_3d`；交通 `class`、`subclass`、`oneway`、`ramp`、`brunnel`、`surface`、`toll`；POI `name`、`class`、`subclass`、`rank`。
- 道路名称/编号在独立的 `transportation_name` layer；道路 geometry layer 不提供 `lanes` 或 `maxspeed`。点击查看器只能显示源里有的字段，不应补造车道数、限速、拥堵或建筑名称。
- 建筑源 layer 从 zoom 13 开始，POI 从 zoom 11 开始；不同展示 zoom 可以根据性能与视觉效果再限制。
- 保留 provider attribution：OpenFreeMap、© OpenMapTiles、[OpenStreetMap contributors](https://www.openstreetmap.org/copyright)。OSM 数据适用 ODbL，schema 的许可与数据许可分开。

选择理由：无需先下载数百 MB 原始地区数据，即可在 Southern California 连续浏览真实道路与建筑；以后更换 source URL 即可切换到自托管、同 schema 的地区瓦片。可用性依赖外部公开服务，第一版并非离线底图。

## 官方公共交通快照：SoCal 扩展

现有 Metro Rail / Bus、OCTA、Metrolink 的原始 ZIP 和 namespaced IDs 保持不变。扩展后实际导入 **15 个 feed 组、537 条路线、29,991 个 agency 站点**，覆盖 San Diego、Inland Empire、Imperial、Kern、Ventura、Santa Barbara、San Luis Obispo 的已接入机构。站点跨 feed 不强行合并；15 个 feed 组不等于 15 家独立运营商，因为 Ventura 使用官方县级聚合 feed。

| Feed 组 | 已显示路线 | 站点 | 官方来源和发布端点 |
| --- | ---: | ---: | --- |
| `metro-rail` · LA Metro Rail | 6 | 111 | [发布方页面](https://developer.metro.net/gtfs-schedule-data/) · [GTFS](https://gitlab.com/LACMTA/gtfs_rail/-/raw/master/gtfs_rail.zip) |
| `metro-bus` · LA Metro Bus | 114 | 11,892 | [发布方页面](https://developer.metro.net/gtfs-schedule-data/) · [GTFS](https://gitlab.com/LACMTA/gtfs_bus/-/raw/weekly-updated-service/gtfs_bus.zip) |
| `octa` · OC Bus · OCTA | 59 | 5,083 | [发布方页面](https://www.octa.net/about/about-octa/open-data) · [GTFS](https://www.octa.net/current/google_transit.zip) |
| `metrolink` · Metrolink | 7 | 67 | [发布方页面](https://metrolinktrains.com/about/gtfs/) · [GTFS](https://metrolinktrains.com/globalassets/about/gtfs/gtfs.zip) |
| `mts` · San Diego MTS | 103 | 4,091 | [发布方页面](https://www.sdmts.com/business-center/app-developers) · [GTFS](https://www.sdmts.com/google_transit_files/google_transit.zip) |
| `rta` · Riverside Transit Agency | 35 | 2,157 | [发布方页面](https://www.riversidetransit.com/) · [GTFS](https://www.riversidetransit.com/google_transit.zip) |
| `omnitrans` · Omnitrans | 28 | 2,234 | [发布方页面](https://omnitrans.org/) · [GTFS](https://www.omnitrans.org/google/google_transit.zip) |
| `sunline` · SunLine Transit | 17 | 572 | [发布方页面](https://www.sunline.org/rider-resources/download-apps) · [GTFS](https://sunlinebus.com/gtfs) |
| `ivt` · Imperial Valley Transit | 15 | 143 | [发布方页面](https://www.ivtransit.com/gtfs) · [GTFS](https://schedule.ivtransit.com/gtfs/data.zip) |
| `kern-transit` · Kern Transit | 12 | 219 | [发布方页面](https://kerntransit.org/developers-gtfs/) · [GTFS](https://data.trilliumtransit.com/gtfs/kerncounty-ca-us/kerncounty-ca-us.zip) |
| `get` · Golden Empire Transit | 16 | 1,053 | [发布方页面](https://www.getbus.org/) · [GTFS](http://eta.getbus.org/rtt/public/utility/gtfs.aspx) |
| `sbmtd` · Santa Barbara MTD | 39 | 631 | [发布方页面](https://sbmtd.gov/gtfs/) · [GTFS](https://www.sbmtd.gov/google_transit/feed.zip) |
| `slorta` · SLO Regional Transit | 18 | 340 | [发布方页面](https://www.slorta.org/ride-guide/faq/) · [GTFS](https://slo.connexionz.net/rtt/public/resource/gtfs.zip) |
| `slo-transit` · SLO Transit | 13 | 161 | [发布方页面](https://www.slocity.org/government/department-directory/public-works/slo-transit/general-service-information/short-range-transit-plan) · [GTFS](https://slocity.connexionz.net/rtt/public/resource/gtfs.zip) |
| `ventura-county` · Ventura County Transit · 9 operators | 55 | 1,237 | [发布方页面](https://gtfs-directory.syncromatics.com/) · [GTFS](https://govcbus.com/gtfs) |

所有已显示路线来自原始官方 GTFS 中的真实 shapes。新来源通过实际 ZIP、agency.txt、feed_info.txt 与源页面交叉检查；没有用 stop-to-stop 直线补画缺失线路。SunLine 和 Ventura 当前公开发布地址另外从[发布商 Syncromatics 的公共目录](https://gtfs-directory.syncromatics.com/)核对。VCTC [官方文件](https://www.goventura.org/wp-content/uploads/2022/03/Addendum-1-QA-RFP-2202-90164-ZEB.pdf)明确指向该目录和县级聚合 feed。SLO RTA 的下载地址直接发布在[官方 FAQ](https://www.slorta.org/ride-guide/faq/)。

### 获取差异和实际覆盖缺口

- **Riverside Transit Agency**：2026-10-12 直接官方 HTTP / HTTPS ZIP 均返回 403。因此明确使用 [MobilityData 的官方原始 feed 归档](https://mobilitydatabase.org/feeds/gtfs/mdb-98)，归档时间 **2026-09-14**，实际服务日历 2026-09-13–2027-01-09。固定 ZIP 为 `https://files.mobilitydatabase.org/mdb-98/mdb-98-202609140150/mdb-98-202609140150.zip`。这不是今天从 RTA 重新刷新的 feed。manifest 分开记录 `feedUrl`、`downloadUrl`、`archiveDate`、`archiveSourceUrl`、`retrievalNote`；路线详情显示归档日期。后续更新必须重新核对官方端点或选择明确日期的新归档。
- **NCTD 未接入**：官方 `https://lfportal.nctd.org/staticGTFS/google_transit.zip` 在本次请求中重置连接。[公开 feed 目录](https://mobilitydatabase.org/feeds/gtfs/mdb-3093)同样注明无法下载。没有取得可验证的当前公开 ZIP，因此 **COASTER、SPRINTER、BREEZE 不在快照中**，也没有用过期 feed 或虚构线路替代。manifest 的 `coverageGaps` 保留这一缺口。
- **Golden Empire Transit**：官方发布的是 HTTP 地址；改用 HTTPS 时证书 hostname 不匹配，因此保留官方 HTTP 下载，未关闭 TLS 校验。
- **Ventura 县级 feed**：包括 Gold Coast、Thousand Oaks、VCTC Intercity、Kanan Shuttle、Moorpark、Ojai Trolley、Valley Express、Simi Valley、Camarillo。前端作为一个筛选组；原运营商完整 `agency.txt` 保存在 manifest 的 `operators`，每条 route 另保留 `operatorId` / `operatorName`。未叠加 Trillium 版 VCTC feed，避免相同线路重复。
- **仍非全运营商目录**：LA 的其他市政公交、Amtrak、机场班车以及部分农村和按需机构尚未全部接入。范围扩展到 SoCal 不代表每家机构已覆盖。
- 各机构静态数据公开可下载，不代表统一开源许可；遵守各 agency 条款并保留归属，不使用其 logo 或暗示官方关联。实时车辆 API 是独立能力，例如 [MTS 实时 API](https://www.sdmts.com/business-center/app-developers/real-time-data)要求 key；本版本只使用静态 GTFS，不申请或使用实时凭据。

NCTD 还单独复查了旧 `gonctd.com/google_transit.zip`、当前地址的 HTTP 版本、保留证书校验的 TLS 1.2 请求；分别得到连接重置、超时和连接重置。[Caltrans / Cal-ITP 官方 2026-06 报告](https://reports.dds.dot.ca.gov/gtfs_schedule/2026/06/226/index.html)的 North County Schedule 仍指向同一 lfportal 地址。[Caltrans 公共 ZIP 目录](https://gtfs.dds.dot.ca.gov/)没有 NCTD。SANDAG 的派生 GIS 图层能提供历史线路位置，但没有核实到当前 GTFS ZIP 和班次站序，因此本次未用它替代线路详情数据。

### 可复现的导入

```sh
python3 scripts/import_gtfs.py --cache-dir .cache/gtfs
python3 scripts/import_transit_details.py --cache-dir .cache/gtfs
```

显式 `--cache-dir` 复用已有 ZIP；删除需要刷新的缓存再执行可重新下载。省略该参数时，主导入重新下载并把实际用过的 ZIP 保存到默认 `.cache/gtfs`，随后详情导入对 SHA-256，防止网络 geometry 与详情来自不同版本。RTA 是上面明确配置的固定归档，不会自动假装更新。

1. `routes` + `trips` 关联实际 `shapes`，保留所有不同的 feed pattern，只去除完全相同或反向相同的 geometry。
2. Metrolink 当前 `trips.txt` 没有 `shape_id`，因此沿用已核对的 provider mapping，把七条命名路线关联到官方 `shapes.txt` 的形状对；不根据站点坐标猜线路。
3. Douglas–Peucker 简化容差 8 m，保留端点，六位小数。详情长度使用简化前完整 shape，不累加替代路径。
4. `stop_times` 关联路线和站点，platform 合并到 parent station；只保留有已显示路线服务的站点。
5. agency 前缀防止 ID 冲突。保留合法官方颜色；缺失或无效颜色使用注明 `viewer fallback` 的展示色。
6. 校验唯一 ID、stop → route 外键、有限坐标、颜色及每个 feed 的计数；全部成功才写出三份主快照。详情独立对齐所有 feed 的 SHA-256，采用临时文件替换。

源 ZIP 合计 **48,183,087 bytes**。输出线路坐标 **124,753 个**；主 GeoJSON / manifest 合计 **13,033,268 bytes**，低于当前 15 MB 上限。生成时间：`2026-10-12T18:24:17Z`。路线详情是独立小文件，不阻塞底图初始化。

跳过记录均写入 manifest：OCTA 3 条无可用 trip/shape 的 route entries 和 6 个单点 pattern；MTS Coronado Ferry 无可用 shape；RTA 4 条 route entries；Omnitrans 3 条 OmniRide 按需记录；GET Test Route；Ventura 2 条 route entries。保留它们的名称和原因，不生成猜测 geometry。SunLine/Ventura 源日历中的 2099 是 feed 自身的开放结束日期，不是到 2099 的服务承诺。

### 输出和时间语义

- `transit-routes.geojson`：真实 `MultiLineString`，含 route ID、feed 组、运营商名、名称、颜色、GTFS type、官方来源。
- `transit-stops.geojson`：`Point`，含真实站名、所属 feed 和未序列化的 `routeIds` 数组。
- `transit-manifest.json`：筛选索引、全部 bounds、每组来源、下载地址、归档差异、SHA-256、日历范围、跳过记录与覆盖缺口。
- `transit-details.json`：全部 537 条路线的 shape 长度范围、首末站组合和各 feed 的哈希；见 [详情方法](transit-details.md)。

只展示静态 feed 网络形状，不按当日 service ID 过滤。快照可能包括短线、方向变化、测试/训练或季节性源记录；它不是当前车辆位置、班次查询或某日完整运行承诺。跨县线路保留全长，不在县界截断。

## 地形

当前实际接入 [Mapterhorn](https://mapterhorn.com/)，[attribution](https://mapterhorn.com/attribution) 列出原始 DEM 来源。已核对其公开 TileJSON：`https://tiles.mapterhorn.com/tilejson.json`，Terrarium encoding、512 px 瓦片。MapLibre 官方 [3D terrain 示例](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/)采用此来源。图层打开时显示 hillshade，3D 视图中额外生成地形起伏，显示夸张系数为 1.15。

研究中也实测了 AWS Mapzen / Tilezen Terrain Tiles，作为可替换备选；首版没有接入该备用服务。

## 下一阶段：密集建筑、更多 POI、自托管

**Overture Maps**：适合将普通建筑覆盖补齐，并提供稳定 GERS ID。[Buildings guide](https://docs.overturemaps.org/guides/buildings/)说明其优先采用 OSM，并合并其他开放与机器学习 footprint；高度不是每栋都有。[Places guide](https://docs.overturemaps.org/guides/places/)提供额外 POI 和 confidence 字段，也明确存在重复和属性缺失。使用 bounding box / DuckDB 查询地区数据，不能把全球 parquet 直接送进浏览器。依 [许可与署名页](https://docs.overturemaps.org/attribution/)逐 theme 保留归属：buildings 使用 ODbL；places 的来源许可包含 CDLA Permissive / Apache / CC0，不能统一标成一种。Overture 暂未接入第一版。

**政府建筑数据**：LA 的 [Building Footprints](https://www.arcgis.com/home/item.html?id=813fcefde1f64b209103107b26a8909f)页面标示 LARIAC4 / 2014 数据，应先比较年份与覆盖，不能当成 2026 现状。[OC Public Works footprint 目录](https://data-ocpw.opendata.arcgis.com/datasets/8db4b58e6bbf4f6cac676f477348be48_0/explore)可作区域校核候选，尚未验证现有服务、年代、字段与许可，因此不作为 v1 已接入来源。

**自托管路径**：[Geofabrik SoCal extract](https://download.geofabrik.de/north-america/us/california/) → 按地区裁剪 OSM PBF → [Planetiler](https://github.com/onthegomap/planetiler) 使用 OpenMapTiles profile → PMTiles → 支持 HTTP Range + CORS 的静态对象存储。源 PBF 本次目录约 640 MB，Planetiler 还需要 coastlines / Natural Earth，因此未为原型提前下载。这样可保持客户端样式不变并提供可版本化的地区包。[PMTiles](https://docs.protomaps.com/)通过 HTTP range 按需读取 archive。

不要用公共 `tile.openstreetmap.org` 的瓦片抓取来制作离线包；[OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/)禁止此类 bulk download。若未来需要离线，应由合法原始地区数据生成自有瓦片。
