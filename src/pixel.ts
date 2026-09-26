// Pinned native-renderer adapter. UI components use logical terminal-relative
// units; engine surfaces and the session wire protocol retain physical pixels.
export * from '../node_modules/@zenbu-labs/pixel/dist/react';
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import * as Native from '../node_modules/@zenbu-labs/pixel/dist/react';
import { physicalStyle, terminalScale } from './display';
let scale = 1;
export const displayScale = () => scale;
function point<T extends { x: number; y: number }>(e: T): T { return { ...e, x: e.x / scale, y: e.y / scale }; }
function events<P extends Pick<Native.BoxProps, 'onClick' | 'onDrag' | 'onMouseMove' | 'onPointer' | 'onClickOutside' | 'onWheel' | 'onScroll'>>(p: P): P {
  return { ...p,
    ...(p.onClick && { onClick: (e: Native.ClickEvent) => p.onClick!(point(e)) }),
    ...(p.onClickOutside && { onClickOutside: (e: Native.ClickEvent) => p.onClickOutside!(point(e)) }),
    ...(p.onDrag && { onDrag: (e: Native.DragEvent) => p.onDrag!(point(e)) }),
    ...(p.onMouseMove && { onMouseMove: (e: Native.MouseMoveEvent) => p.onMouseMove!(point(e)) }),
    ...(p.onPointer && { onPointer: (e: Native.PointerEvent) => p.onPointer!(point(e)) }),
    ...(p.onWheel && { onWheel: (e: Native.WheelEvent) => p.onWheel!({ ...point(e), deltaX: e.deltaX / scale, deltaY: e.deltaY / scale }) }),
    ...(p.onScroll && { onScroll: (e: Native.ScrollEvent) => p.onScroll!({ offset: e.offset / scale, max: e.max / scale }) }),
  };
}
function component<P extends { style?: Native.Style }>(Host: React.ForwardRefExoticComponent<P & React.RefAttributes<Native.NodeHandle>>, map: (props: P) => P) {
  const WithRef = forwardRef<Native.NodeHandle, P>((props, ref) => {
    const node = useRef<Native.NodeHandle>(null);
    useImperativeHandle(ref, () => ({ get id() { return node.current!.id; }, focus: () => node.current!.focus(), blur: () => node.current!.blur(), scrollTo: (offset, smooth) => node.current!.scrollTo(offset * scale, smooth), scrollIntoView: smooth => node.current!.scrollIntoView(smooth), splice: (start, end, text) => node.current!.splice(start, end, text), selectAll: () => node.current!.selectAll(), addMark: (mark, offset) => node.current!.addMark(mark, offset), removeMark: mark => node.current!.removeMark(mark) }), []);
    const p = map(props as P);
    return React.createElement(Host, { ...p, ref: node, style: physicalStyle(p.style, scale) });
  });
  return forwardRef<Native.NodeHandle, P>((props, ref) => {
    if (ref) return React.createElement(WithRef, { ...props, ref });
    const p = map(props as P);
    return React.createElement(Host, { ...p, style: physicalStyle(p.style, scale) });
  });
}
export const Box = component(Native.Box, p => ({ ...events(p), contentHeight: p.contentHeight === undefined ? undefined : p.contentHeight * scale,
  onSelection: p.onSelection && (e => p.onSelection!({ ...point(e), w: e.w / scale, h: e.h / scale })),
}));
export const Text = component(Native.Text, events);
export const Path = component(Native.Path, events);
function caret<T extends Native.CaretInfo>(e: T): T { return { ...point(e), w: e.w / scale, h: e.h / scale }; }
export const Input = component(Native.Input, p => ({ ...p,
  onChange: p.onChange && ((text, change) => p.onChange!(text, caret(change))),
  onCaret: p.onCaret && (e => p.onCaret!(caret(e))),
}));
export const Image = component(Native.Image, events);
export const MarkedText = component(Native.MarkedText, events);

export function createRoot(options: Native.RootOptions = {}): Native.PixelRoot {
  let raw: Native.PixelRoot | undefined;
  let initialBase = 0, initialCell = { width: 8, height: 18 };
  const info = () => {
    const i = raw!.info, ratio = initialBase ? i.basePx / initialBase : 1;
    const cell = { width: initialCell.width * ratio, height: initialCell.height * ratio };
    scale = terminalScale(cell.height);
    return { ...i, width: i.width / scale, height: i.height / scale, basePx: i.basePx / scale, cellWidth: cell.width / scale, cellHeight: cell.height / scale };
  };
  raw = Native.createRoot({ ...options,
    onRightClick: options.onRightClick && (e => options.onRightClick!(point(e))),
    onResize() { if (!raw) return; const i = info(); options.onResize?.({ width: i.width, height: i.height, basePx: i.basePx }); },
  });
  initialBase = raw.info.basePx; initialCell = { width: raw.info.cellWidth, height: raw.info.cellHeight }; info();
  return { ...raw, get info() { return info(); } };
}
