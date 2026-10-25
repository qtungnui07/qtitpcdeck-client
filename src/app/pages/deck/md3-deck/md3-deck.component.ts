import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import {
  ActionButtonTriggerType,
  bundledTranslator,
  EmptyCellStyle,
  GridWidget,
  renderWidgetGrid,
  resolveFolderGrid,
  UiNode,
  UiRenderHost,
  WidgetGridHandle
} from '@macro-deck/runtime';
import {Md3DeckStoreService} from "../../../services/md3/md3-deck-store.service";
import {Md3WidgetSessionService} from "../../../services/md3/md3-widget-session.service";
import {Md3ActionService} from "../../../services/md3/md3-action.service";
import {Md3IpcFolder, Md3IpcWidget} from "../../../datatypes/md3/md3-protocol";

/**
 * Paints a Macro Deck 3 folder.
 *
 * The host owns every widget's appearance: it builds a `UiNode` tree per widget and pushes it over
 * the widget's UI session. This component only lays the tiles out and forwards presses.
 */
@Component({
  selector: 'app-md3-deck',
  templateUrl: './md3-deck.component.html',
  styleUrls: ['./md3-deck.component.scss']
})
export class Md3DeckComponent implements AfterViewInit, OnChanges, OnDestroy {

  @Input() folder!: Md3IpcFolder;

  @ViewChild('surface', {static: true}) surface!: ElementRef<HTMLElement>;

  private grid: WidgetGridHandle | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeFrame: number | null = null;
  private readonly resourceUrls = new Map<string, string>();
  private readonly resourcePending = new Set<string>();

  constructor(private store: Md3DeckStoreService,
              private sessions: Md3WidgetSessionService,
              private actions: Md3ActionService) {
  }

  ngAfterViewInit(): void {
    const baseUrl = this.store.baseUrl();
    const connection = this.store.connection();
    if (baseUrl !== null && connection !== null) {
      this.sessions.configure(baseUrl, connection, {
        onTree: (widgetId, tree) => this.onTree(widgetId, tree),
        onPatch: (widgetId, patch) => this.onPatch(widgetId, patch),
        onEnded: widgetId => this.onEnded(widgetId)
      });
    }
    this.paint();
    // The renderer measures once and keeps that measurement: nothing in it
    // listens for a size change. A phone that turns to landscape therefore
    // kept the portrait cell size, and the deck stayed a narrow column.
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.scheduleResize());
      this.resizeObserver.observe(this.surface.nativeElement);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['folder'] !== undefined && this.grid !== null) {
      this.paint();
    }
  }

  ngOnDestroy(): void {
    if (this.resizeFrame !== null) {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.grid?.destroy();
    this.grid = null;
    this.resourceUrls.forEach(url => URL.revokeObjectURL(url));
    this.resourceUrls.clear();
  }

  // One re-layout per frame: a rotation reports several observer callbacks as
  // the safe area and the toolbar settle, and each repaint re-renders every
  // tile's tree.
  private scheduleResize(): void {
    if (this.resizeFrame !== null) {
      return;
    }
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = null;
      this.grid?.resize();
    });
  }

  // Bytes for icons and artwork land after the tiles were painted; the grid
  // only repaints on size changes, so without this re-render a button that
  // never ticks keeps its empty icon slot forever.
  private redraw(): void {
    if (this.grid === null || this.folder === undefined) {
      return;
    }
    const widgets = this.gridWidgets(this.folder);
    this.grid.update(widgets, widgetId => this.sessions.tree(widgetId));
  }

  private paint(): void {    if (this.folder === undefined) {
      return;
    }
    const widgets = this.gridWidgets(this.folder);
    const geometry = resolveFolderGrid({
      cols: this.folder.columns ?? null,
      rows: this.folder.rows ?? null,
      spacing: this.folder.widgetSpacing ?? null,
      borderRadius: this.folder.widgetBorderRadius ?? null,
      emptyCellStyle: this.folder.emptyCellStyle as EmptyCellStyle | null | undefined
    });

    if (this.grid === null) {
      this.grid = renderWidgetGrid(this.surface.nativeElement, {
        host: this.renderHost(),
        onWidgetEvent: (widgetId, node, name, data) => this.sessions.sendEvent(widgetId, node.id, name, data),
        onWidgetTrigger: (widgetId, triggerType) => this.trigger(widgetId, triggerType),
        geometry: {cols: geometry.cols, rows: geometry.rows, spacing: geometry.spacing, outerMargin: 0},
        borderRadius: geometry.borderRadius,
        emptyCellStyle: geometry.emptyCellStyle,
        shadows: geometry.shadows
      });
    }

    this.grid.update(widgets, widgetId => this.sessions.tree(widgetId));
    this.grid.setBackground(this.folder.backgroundColor ?? null);
    // Only the widgets on screen hold a session; the host caps how many a provider may have open.
    this.sessions.sync(widgets.map(widget => widget.id));
  }

  private onTree(widgetId: string, tree: UiNode): void {
    this.grid?.updateWidget(widgetId);
  }

  private onPatch(widgetId: string, patch: unknown): void {
    this.grid?.updateWidget(widgetId);
  }

  private onEnded(widgetId: string): void {
    this.grid?.updateWidget(widgetId);
  }

  private trigger(widgetId: string, triggerType: ActionButtonTriggerType): void {
    void this.actions.execute(widgetId, this.folder.id, triggerType);
  }

  private gridWidgets(folder: Md3IpcFolder): GridWidget[] {
    return (folder.widgets ?? []).map(widget => Md3DeckComponent.toGridWidget(widget, folder.id));
  }

  private static toGridWidget(widget: Md3IpcWidget, folderId: string): GridWidget {
    return {
      id: widget.id,
      folderId: folderId,
      x: widget.positionX,
      y: widget.positionY,
      w: widget.width,
      h: widget.height,
      type: widget.type,
      data: Md3DeckComponent.parseData(widget.data),
      isPinned: widget.isPinned,
      pinScope: widget.pinScope as GridWidget["pinScope"]
    };
  }

  private static parseData(data: string | undefined): GridWidget["data"] {
    if (data === undefined || data.length === 0) {
      return {} as GridWidget["data"];
    }
    try {
      return JSON.parse(data) as GridWidget["data"];
    } catch {
      return {} as GridWidget["data"];
    }
  }

  private renderHost(): UiRenderHost {
    return {
      // The host's catalogue is not fetched yet, so the strings compiled into the runtime are used.
      localization: {translate: (scope, key, args) => bundledTranslator(`${scope}:${key}`, args)},
      resourceUrl: (resource, hint) => this.resourceUrl(resource, hint),
      now: () => Date.now(),
      culture: () => (typeof navigator === "undefined" ? "en" : navigator.language) || "en",
      simpleRendering: () => false,
      fontFamily: () => null,
      fontReady: () => true,
      emit: () => undefined
    };
  }

  // The resource endpoint needs an Authorization header, so the bytes are fetched and the renderer is
  // handed a blob URL. The first call returns null and the tile repaints once the bytes arrive.
  private resourceUrl(resource: {resourceId: string, contentHash?: string} | undefined, hint?: {displayPx?: number}): string | null {
    if (resource === undefined) {
      return null;
    }
    const size = hint?.displayPx === undefined ? undefined : Math.round(hint.displayPx);
    const key = `${resource.resourceId}|${resource.contentHash ?? ""}|${size ?? ""}`;
    const cached = this.resourceUrls.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (!this.resourcePending.has(key)) {
      this.resourcePending.add(key);
      void this.sessions.resourceUrl(resource.resourceId, resource.contentHash, size).then(url => {
        this.resourcePending.delete(key);
        if (url === null) {
          return;
        }
        this.resourceUrls.set(key, url);
        this.redraw();
      });
    }
    return null;
  }
}
