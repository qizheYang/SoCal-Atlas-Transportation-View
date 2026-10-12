# 公共交通长度与首末站

`python3 scripts/import_transit_details.py` 从 `.cache/gtfs/*.zip` 生成 `public/data/transit-details.json`，仅依赖 Python 标准库。先运行已有 GTFS 导入器，再生成本文件。为防止详情与地图使用不同版本，脚本逐个核对 ZIP 的 SHA-256 与 `transit-manifest.json`。

当前快照覆盖全部 **537 条**地图线路、**1,835 组**有方向的首末站组合。各个班次按 `stop_times.stop_sequence` 的最小和最大值确定端点，platform 合并至其 parent station；保留短线、不同方向及环线组合。排序按 feed 内 trip 记录数，该数字并非每日发车次数。

长度使用 `trips.shape_id` 关联的实际完整 `shapes`，排序后逐段累计球面距离；去除完全相同及完全反向的重复形状，再列出最小和最大值。没有把各个方向、分支和替代形状相加成单程长度。Metrolink 缺少 trip 的 shape_id，沿用已有导入器中经核对的官方命名形状映射。

部分短线 trip 引用整线 shape，因此长度范围描述**源文件映射的线路形状**，不是各组首末站间的逐班次行驶距离。该限制同样适用于某些 Metro Rail 班次，不只 Metrolink。数据不按今日 service calendar 过滤，不表示实时运行状态。

示例核验：A Line 为约 93.0 km，主要首末站是 Pomona North Station 与 Downtown Long Beach Station；B Line 为约 25.2 km，主要首末站是 Union Station 与 North Hollywood Station。来源链接与抓取日期逐线路保存，继承已有官方 GTFS 清单。

验证：`python3 -m unittest discover -s scripts -p 'test_import_transit_details.py' -v`。五个测试覆盖 stop_sequence 与 parent station、短线与反向首末站保留、形状去重与长度不相加、实际折线路径测长、所有已发布路线及端点坐标完整性。

SoCal 扩展使用 15 个 feed 组，全部 537 条地图路线都有详情。文件约 574 KB。`sourceFeeds` 保存每个 feed 的 SHA-256、抓取时间、下载 URL 和可选归档日期，测试逐个与主 manifest 对齐。RTA 详情明确显示 `archive 2026-09-14` 并链接归档来源；NCTD 未取得可验证 ZIP，不出现在地图或详情中。Ventura 聚合 feed 的各运营商信息保存在主 manifest 和 route 索引中。
