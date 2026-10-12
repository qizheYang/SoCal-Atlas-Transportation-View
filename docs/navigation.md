# 地图导航与触摸板

默认入口使用 SoCal 十县的联合边界进行 `fitBounds`，北朝上、2D；初始化和“全览”都按当前面板、导航控件、顶部栏和底部工具栏计算留白。区域范围包含现有官方边界中的离岸岛屿。道路、公交高亮仍可在后续浏览中保留。

## 操作方式

- **触摸板模式（默认）**：两指上下、左右滑动平移；捏合缩放，缩放位置跟随指针。普通拖动也可平移。
- **鼠标模式**：滚轮使用 MapLibre 原生缩放；拖动平移。
- 两种模式都有缩放、左右旋转、北向复位、2D / 3D 和区域全览按钮。两指旋转和触屏倾斜默认关闭，避免平移和捏合时意外改变朝向；MapLibre 的 Ctrl + 拖动／右键拖动旋转仍可用。
- 搜索列表和详情面板上的滚动仅滚动面板；地图手势监听器只覆盖地图画布。

## 实现与浏览器差异

检查过本地固定版本 MapLibre GL JS 6.14.0 的 `scroll_zoom.ts`、`handler_manager.ts`、`map_event.ts` 与 `camera.ts`。MapLibre 默认把普通触摸板滚动解释为缩放；本项目在触摸板模式关闭该处理器，并在画布的 capture 阶段处理 wheel，再阻止同一事件继续交给 MapLibre。鼠标模式恢复原生处理器。

普通 wheel 的两轴位移按 pixel、line、page 单位归一化，合并至下一帧平移。Chromium / Firefox 的捏合对应 `ctrlKey` wheel；相同帧的缩放限制为一个 zoom level，避免异常输入造成突然跳跃。Safari 的 `gesturestart` / `gesturechange` / `gestureend` 使用相对初始距离的 scale，转换为 `log2(scale)` 的绝对 zoom 变化。若浏览器同时发出 wheel 与 gesture，保留先到的输入流，避免重复缩放。实际触屏的多点输入继续由 MapLibre 处理。切换模式、组件卸载时会取消未提交帧；卸载时移除全部监听器。

来源：

- [MapLibre ScrollZoomHandler](https://maplibre.org/maplibre-gl-js/docs/API/classes/ScrollZoomHandler/)
- [MapLibre：关闭地图旋转](https://maplibre.org/maplibre-gl-js/docs/examples/disable-map-rotation/)
- [MapLibre Map API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/)
- [MDN wheel：滚动与 Ctrl-key 捏合事件](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event)
- [Apple GestureEvent.scale](https://developer.apple.com/documentation/webkitjs/gestureevent/1632653-scale)

## 验证范围

`src/map/navigation.test.ts` 的 8 项测试覆盖二维平移、单位换算、指针缩放、异常输入限幅、Safari 双流两种先后顺序、触屏不重复处理、模式切换和生命周期清理；`roadGeometry.test.ts` 另有居中底部控件留白回归。

这些测试验证事件与相机指令，不代替实体触摸板测试。验收时应在 Safari 和 Chromium 的实际触摸板上确认：双指滑动不改变 zoom、捏合不缩放网页、松手后没有第二次缩放、在搜索列表滚动不移动底图。操作系统若截获某些系统手势，页面无法接收到那些事件；按钮始终可用于相同导航动作。

本次通过 Chrome 原生界面观察到默认 SoCal / 2D / Z6.4；对地图发送普通滚动后仅中心纬度改变，zoom 保持 6.4。Safari 另一较窄窗口默认 fitBounds 为 Z5.0；点击 Historic Broadway 端点后到达 Z16，并确认 A／E 蓝黄棋盘。详情打开时工作区自动收起，导航移到详情下方。实际硬件捏合仍需独立验收。
