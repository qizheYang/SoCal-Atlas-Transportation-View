import { useEffect, useId, useRef } from "react";
import { Keyboard, X } from "lucide-react";
import "./keyboardHelp.css";

function Keys({ values }: { values: string[] }) {
  return (
    <span className="keyboard-help__keys">
      {values.map((value) => (
        <kbd key={value}>{value}</kbd>
      ))}
    </span>
  );
}

export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="keyboard-help"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="keyboard-help__content">
        <header className="keyboard-help__header">
          <div>
            <span className="keyboard-help__eyebrow">
              <Keyboard size={16} aria-hidden="true" /> CAMERA CONTROLS
            </span>
            <h2 id={titleId}>用键盘探索 SoCal</h2>
          </div>
          <button
            ref={closeRef}
            className="keyboard-help__close"
            type="button"
            onClick={onClose}
            aria-label="关闭键盘操作说明"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="keyboard-help__body">
          <p id={descriptionId} className="keyboard-help__intro">
            点击地图后，按住按键连续移动。可组合平移、旋转与缩放。
          </p>

          <section aria-labelledby={`${titleId}-camera`}>
            <h3 id={`${titleId}-camera`}>相机 · CSL2 风格</h3>
            <dl className="keyboard-help__bindings">
              <div>
                <dt>
                  <Keys values={["W", "A", "S", "D"]} />
                </dt>
                <dd>向画面上、左、下、右平移</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["Q", "E"]} />
                </dt>
                <dd>向左 / 向右旋转</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["R", "F"]} />
                </dt>
                <dd>拉近 / 拉远</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["T", "G"]} />
                </dt>
                <dd>更多倾斜 / 更加俯视</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby={`${titleId}-shortcuts`}>
            <h3 id={`${titleId}-shortcuts`}>地图快捷操作</h3>
            <dl className="keyboard-help__bindings">
              <div>
                <dt>
                  <Keys values={["↑", "←", "↓", "→"]} />
                </dt>
                <dd>也可平移地图</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["Shift"]} />
                </dt>
                <dd>按住时，相机速度 ×2</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["+", "−"]} />
                </dt>
                <dd>也可拉近 / 拉远</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["N"]} />
                </dt>
                <dd>恢复北朝上</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["0"]} />
                </dt>
                <dd>回到 SoCal 全览</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["U"]} />
                </dt>
                <dd>全览已高亮的道路与线路</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["/"]} />
                </dt>
                <dd>搜索道路、地点与线路</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["?"]} />
                </dt>
                <dd>打开这份操作说明</dd>
              </div>
              <div>
                <dt>
                  <Keys values={["Esc"]} />
                </dt>
                <dd>关闭当前面板或对话框</dd>
              </div>
            </dl>
          </section>

          <p className="keyboard-help__note">
            输入文字、操作表单或打开对话框时，相机快捷键会暂停。 Ctrl、⌘、Alt
            组合键保留给浏览器。返回地图后点击一下即可继续；
            也可用导航栏的键盘开关停用相机快捷键。
          </p>
        </div>
      </div>
    </dialog>
  );
}
