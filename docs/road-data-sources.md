# 道路搜索、城市边界数据

核查日期：2026-10-12。覆盖 **Southern California 10 县**：Imperial、Kern、Los Angeles、Orange、Riverside、San Bernardino、San Diego、San Luis Obispo、Santa Barbara、Ventura。LA/OC 保留为独立导航视图，数据目录包含所有十县。

道路名称搜索使用独立的 Census 道路目录；城市归属使用实际行政区 polygon 与道路线段相交，不能由地图地名、最近城市中心、邮寄地址或当前视窗推断。版本是静态快照，不能用于实时交通或驾车导航。

## 道路目录与几何

道路来自 Census 官方 **TIGER/Line 2025 All Roads** 县级 ZIP；[发布页](https://www.census.gov/geographies/mapping-files/2025/geo/tiger-line-file.html)说明该版本名称和法定边界参考日为 2025-01-01。

| 县 | FIPS | 官方下载 | 原始线记录 | 纳入的有名车辆道路记录 |
| --- | --- | --- | ---: | ---: |
| Imperial County | `06025` | [ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06025_roads.zip) | 8,066 | 5,010 |
| Kern County | `06029` | [ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06029_roads.zip) | 57,002 | 23,192 |
| Los Angeles County | `06037` | [ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06037_roads.zip) | 121,296 | 84,472 |
| Orange County | `06059` | [ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06059_roads.zip) | 56,627 | 46,970 |
| Riverside County | `06065` | [ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06065_roads.zip) | 57,247 | 47,295 |
| San Bernardino County | `06071` | [ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06071_roads.zip) | 71,978 | 50,571 |
| San Diego County | `06073` | [ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06073_roads.zip) | 60,074 | 44,169 |
| San Luis Obispo County | `06079` | [ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06079_roads.zip) | 17,251 | 9,431 |
| Santa Barbara County | `06083` | [ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06083_roads.zip) | 15,933 | 8,199 |
| Ventura County | `06111` | [ZIP](https://www2.census.gov/geo/tiger/TIGER2025/ROADS/tl_2025_06111_roads.zip) | 22,327 | 15,760 |

纳入 MTFCC `S1100`, `S1200`, `S1400`, `S1500`, `S1630`, `S1640`, `S1730`, `S1740`；无名称线段和非车辆步道不进入名称搜索。定义见 [2025 技术文档](https://www2.census.gov/geo/pdfs/maps-data/data/tiger/tgrshp2025/TGRSHP2025_TechDoc.pdf)。背景地图仍可显示额外 OSM 道路，此目录和背景不是相同的数据快照。

当前目录有 **293,079 个道路候选**：263 个高速／编号公路候选、292,816 个普通道路候选。其中 **149 条编号公路**各有一个条目，已逐条核对十县全部原始 `LINEARID` 集合的 SHA-256 和记录数量，保证其完整区域源数据均纳入。原先 LA/OC 的编号路归组规则保持一致。

`scripts/import_roads.py` 完整处理所选县域数据，无需将道路移入当前视窗才能搜索：

1. 编号道路规范为 `I-5`、`US-101`、`CA-1` 等，保留源文件名称和查询别名；规范化可以重复执行，`E/W State Rte 66` 同属 `CA-66`。同一编号在所有选中县中的全部源线段作为一个条目，包括分隔车道和不连续部分，保留实际几何间隙。
2. 普通道路保留原名称 alias；对名称开头的方向词作规范化，保留 `South St`、`West Blvd`、`E St` 这类实际名称。只有几何连通或距离在 **20 米**内的同名线段才归成同一路；没有合成连接线，同名但断开的道路保持独立候选。20 米是源数据归组容差，并不是官方道路身份保证。
3. 全精度道路与城市/CDP/剩余未建制 polygon 相交，交集线长至少 **0.5 米**才纳入经过区域，排除点状相切。城市列表按在各区域内的映射线长排序，不是驾驶经过的先后顺序。
4. 道路与区域边界相交生成提示点，30 米内多个点合并；界线上道路保留两侧区域。显示几何按 **2 米**简化并保留六位经纬度，归属计算发生在简化前。源 NAD83 转换到 UTM Zone 11N 计算，输出 WGS84。
5. 开放端点来自显示简化前的完整线网；20 米内小间隙仅在满足向外延伸方向的连续关系时排除，平行车道端点和实际分支保留。当前 **605,387 个端点**全部通过几何顶点核对；493 条道路没有开放端点；133 个端点没有精确匹配城市 polygon，保持未匹配。`endpointGeometryBasis` 标注 `unsimplified Census TIGER/Line source geometry`。
6. 编号公路另记录 `sourceRecordCount` 和 `sourceLinearIdSha256`，便于核对全部来源线段。`lengthKm` 是映射线的总长度，分隔道路两侧分别计入，不等同单向行驶里程。端点是十县范围内的源几何端点，不是全国道路官方首末点或行驶方向。

编号道路与其地方 freeway 名称可能分别出现且几何重叠，不能单靠文字名称猜成同一个对象。普通同名道路即使在同一城市，若源几何不连通也保留独立候选。源中缺失的道路或名称无法由目录补造。

## 数据分片与重建

索引 raw **100.9 MB**，gzip **13.1 MB**。256 个几何分片 raw 合计 **212.6 MB**、gzip 合计 **33.0 MB**；只在选择道路时加载所需分片。浏览器优先显式解压 gzip，保留 raw fallback。

仓库只提交 gzip 索引和 gzip 分片，避免重复提交大型生成文件。`scripts/materialize-road-data.mjs` 使用 Node 内置 zlib 确定性还原 raw 文件；缺少必需压缩文件或压缩内容损坏会明确失败。dev/build/preview 前执行还原，因而 raw fallback 仍可使用，不要求每个浏览器都支持 `DecompressionStream`。

- `public/data/roads-index.json.gz`：完整道路目录、来源、处理方法和统计。
- `public/data/roads/*.geojson.gz`：256 个稳定 ID 分片。
- `public/data/roads-index.json`、`public/data/roads/*.geojson`：由 gzip 还原或导入器生成，不入库。
- `.cache/roads/tl_2025_{countyFips}_roads.zip`：十县官方全精度源 ZIP，缓存不入库。

索引保留源 URL、字节数、SHA-256、抓取时间、原始/纳入记录数、边界版本与方法。生成道路之前必须先生成同范围边界，若两个县集合不一致会拒绝导入。

```sh
node scripts/materialize-road-data.mjs
.venv-data/bin/python scripts/import_boundaries.py --scope socal-ten
.venv-data/bin/python scripts/import_roads.py --scope socal-ten
.venv-data/bin/python scripts/audit_road_data.py --scope socal-ten
```

共享范围配置在 `scripts/region_scopes.py`：默认 `socal-ten`，也支持 `core-six`、`la-oc`；`--counties 06037,06059` 显式覆盖预设。`--download-only` 仅预取源，不替换发布数据。`--refresh` 重新下载；缓存按县或查询县集合区分，不能误用其他范围的边界缓存。

## 官方城市与县界

使用 [U.S. Census Bureau TIGERweb 当前服务](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer)，官方城市图层元数据核验为 **2026-01-01** 边界版本。

| 图层 | 官方接口 | 用途 |
| --- | --- | --- |
| Incorporated Places | [layer 28](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/28) | 法定建制市 |
| Census Designated Places | [layer 30](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/30) | 未建制社区的统计边界 |
| Counties | [layer 82](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/82) | 完整县域，包括离岸岛屿 |

全部请求 GeoJSON `outSR=4326`。先以所选县外接矩形获取候选 place，再用完整县界裁剪；仅接触县界的邻县城市不进入目录。县域减去全部城市与 CDP 并集，得到每县独立的剩余未建制地区 `Unincorporated <County>`。CDP 自身也属未建制地区，但保留独立名称，不能称作 incorporated city。

当前有 **573 个区域**：235 个建制市部分、328 个 CDP 部分、10 个各县剩余未建制 feature。城市跨县时按县保留独立部分。

| 县 | 建制市 | CDP | 剩余未建制 feature |
| --- | ---: | ---: | ---: |
| Imperial County | 7 | 11 | 1 |
| Kern County | 11 | 77 | 1 |
| Los Angeles County | 88 | 54 | 1 |
| Orange County | 34 | 13 | 1 |
| Riverside County | 28 | 47 | 1 |
| San Bernardino County | 24 | 28 | 1 |
| San Diego County | 18 | 39 | 1 |
| San Luis Obispo County | 7 | 23 | 1 |
| Santa Barbara County | 8 | 20 | 1 |
| Ventura County | 10 | 16 | 1 |

完整边界用于道路归属；显示边界在 California Albers (`EPSG:3310`) 下做 **3 米** topology-preserving simplification 后返回经纬度。显示 polygon 独立简化，放大后相邻边可能存在数米偏差，完整几何不受此影响。快照不代表此后新并入或改名区域已更新，也不是法律边界认定。

- `public/data/city-boundaries.geojson`：显示边界，7.55 MB。
- `public/data/city-boundaries-manifest.json`：来源、版本、计数、SHA-256、县域覆盖核对。
- `scripts/.cache/boundaries/full-city-boundaries.geojson`：全精度空间连接输入，缓存不入库。
- `scripts/.cache/boundaries/*-{county-set}.geojson`：按所选县集合隔离的源请求缓存。
- `src/data/county-regions.json` 与 `public/data/regions.json`：由实际官方县界生成的导航 bbox、中心与10县全览；北向 bearing=0。

feature 属性包括：`id`（`place-{GEOID}-{countyFips}` 或 `unincorporated-{countyFips}`）、`geoid`、`name`、`label`、`kind`（city/cdp/unincorporated）、`county`、`countyFips`、`bounds`、区域内部代表点 `labelLng/labelLat`、`source`、`vintage`。跨县 place 共享 GEOID，但独立完整 ID 保留县域部分。

## 验证

十县每县的 `county` 与 `union(city, CDP, residual)` symmetric difference 均为 **0.0 平方米**。573 个完整 polygon 全部 valid，区域间超过 1 平方米的重叠为 **0**。道路审计核对所有十县原始计数、每个编号路原始 LINEARID 集合、目录唯一性、所有几何分片对应关系、所有城市外键与全部端点顶点位置。

```sh
.venv-data/bin/python -m unittest discover -s scripts -p 'test_*.py'
node --test scripts/test_materialize_road_data.mjs
```

来源署名 **U.S. Census Bureau**。Census 目录与背景地图的 OpenStreetMap/OpenFreeMap 数据独立保留来源，不将 Census 路网误标为 OSM。
