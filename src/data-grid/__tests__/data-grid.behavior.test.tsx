import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react'
import { DataGrid } from '../data-grid'
import type { DataGridProps } from '../data-grid'
import type { Column, GridSelection } from '../core/types'

// Component/interaction coverage for the React shell (jsdom). The setup gives elements a fixed box
// so the virtualizer renders a window; the grid's geometry is offset-derived, so pointer math
// resolves from the scroll container (rect mocked to {left:0, top:0} globally). Header strip is
// y∈[0,rowHeight); row r is y∈[rowHeight+r*rh, …). Columns are 100px wide → c_i spans x∈[i*100,…).

interface Row {
  id: number
  v: string
}
const ROWS: Row[] = Array.from({ length: 50 }, (_, i) => ({ id: i, v: `r${i}` }))

const centerCols = (): Column<Row>[] => [
  { id: 'c0', name: 'C0', width: 100, accessor: (r) => r.v },
  { id: 'c1', name: 'C1', width: 100, accessor: (r) => r.v },
  { id: 'c2', name: 'C2', width: 100, accessor: (r) => r.v },
  { id: 'c3', name: 'C3', width: 100, accessor: (r) => r.v },
]

function renderGrid(props: Partial<DataGridProps<Row>> = {}) {
  const result = render(
    <DataGrid rows={ROWS} columns={centerCols()} getRowId={(r) => r.id} {...props} />,
  )
  const scroller = result.container.querySelector<HTMLElement>('[tabindex="0"]')
  if (!scroller) throw new Error('scroll container not found')
  return { ...result, scroller }
}

const down = (el: HTMLElement, x: number, y: number, init: Partial<PointerEventInit> = {}) =>
  fireEvent.pointerDown(el, { clientX: x, clientY: y, button: 0, pointerId: 1, ...init })
const move = (el: HTMLElement, x: number, y: number) =>
  fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 })
const up = (el: HTMLElement, x: number, y: number) =>
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 })

// Click = down+up at the same point (no drag).
const click = (el: HTMLElement, x: number, y: number, init?: Partial<PointerEventInit>) => {
  down(el, x, y, init)
  up(el, x, y)
}

const lastSelection = (fn: ReturnType<typeof vi.fn>): GridSelection =>
  fn.mock.calls.at(-1)![0] as GridSelection

describe('selection + keyboard', () => {
  it('clicking a cell focuses it and emits onSelectionChange', () => {
    const onSel = vi.fn()
    const { scroller } = renderGrid({ onSelectionChange: onSel })
    click(scroller, 150, 48) // c1, row 0
    expect(lastSelection(onSel).focusedCell).toEqual({ rowIndex: 0, columnId: 'c1' })
  })

  it('shift-click extends a range from the focused cell', () => {
    const onSel = vi.fn()
    const { scroller } = renderGrid({ onSelectionChange: onSel })
    click(scroller, 50, 48) // c0, row 0
    click(scroller, 350, 112, { shiftKey: true }) // c3, row 2
    const sel = lastSelection(onSel)
    expect(sel.range).toBeTruthy()
    expect(sel.range!.anchor).toEqual({ rowIndex: 0, columnId: 'c0' })
    expect(sel.range!.focus).toEqual({ rowIndex: 2, columnId: 'c3' })
  })

  it('arrow keys move the focused cell; Escape clears a range', () => {
    const onSel = vi.fn()
    const { scroller } = renderGrid({ onSelectionChange: onSel })
    click(scroller, 50, 48) // c0 r0
    fireEvent.keyDown(scroller, { key: 'ArrowRight' })
    expect(lastSelection(onSel).focusedCell).toEqual({ rowIndex: 0, columnId: 'c1' })
    fireEvent.keyDown(scroller, { key: 'ArrowDown' })
    expect(lastSelection(onSel).focusedCell).toEqual({ rowIndex: 1, columnId: 'c1' })
    fireEvent.keyDown(scroller, { key: 'ArrowRight', shiftKey: true }) // extend → range
    expect(lastSelection(onSel).range).toBeTruthy()
    fireEvent.keyDown(scroller, { key: 'Escape' })
    expect(lastSelection(onSel).range).toBeNull()
  })

  it('Cmd/Ctrl+Arrow jumps to the grid edge', () => {
    const onSel = vi.fn()
    const { scroller } = renderGrid({ onSelectionChange: onSel })
    click(scroller, 50, 48) // c0 r0
    fireEvent.keyDown(scroller, { key: 'ArrowRight', metaKey: true })
    expect(lastSelection(onSel).focusedCell!.columnId).toBe('c3') // last column
  })

  it('the first arrow with no focus lands on the origin cell', () => {
    const onSel = vi.fn()
    const { scroller } = renderGrid({ onSelectionChange: onSel })
    fireEvent.keyDown(scroller, { key: 'ArrowDown' })
    expect(lastSelection(onSel).focusedCell).toEqual({ rowIndex: 0, columnId: 'c0' })
  })
})

describe('row-selection gutter', () => {
  it('select-all checks every row', () => {
    const onSel = vi.fn()
    renderGrid({ enableRowSelection: true, onSelectionChange: onSel })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0]) // header select-all
    expect(lastSelection(onSel).selectedRows.size).toBe(ROWS.length)
  })

  it('a row checkbox toggles just that row', () => {
    const onSel = vi.fn()
    renderGrid({ enableRowSelection: true, onSelectionChange: onSel })
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[1]) // first row
    expect(lastSelection(onSel).selectedRows.size).toBe(1)
  })
})

describe('editing', () => {
  const editableCols = (): Column<Row>[] => [
    { id: 'c0', name: 'C0', width: 100, accessor: (r) => r.v, editable: true },
    { id: 'c1', name: 'C1', width: 100, accessor: (r) => r.v },
    { id: 'c2', name: 'C2', width: 100, accessor: (r) => r.v },
    { id: 'c3', name: 'C3', width: 100, accessor: (r) => r.v },
  ]

  it('click-to-edit opens the editor, and Enter commits the new value', async () => {
    const onCellCommit = vi.fn().mockResolvedValue(undefined)
    const { scroller } = renderGrid({ columns: editableCols(), onCellCommit })

    click(scroller, 50, 48) // focus c0 r0
    click(scroller, 50, 48) // click again on the focused cell → opens editor
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(ta).toBeInTheDocument()
    expect(ta.value).toBe('r0')

    fireEvent.change(ta, { target: { value: 'hello' } })
    fireEvent.keyDown(ta, { key: 'Enter' })

    await waitFor(() =>
      expect(onCellCommit).toHaveBeenCalledWith(
        expect.objectContaining({ columnId: 'c0', previousValue: 'r0', nextValue: 'hello' }),
      ),
    )
    expect(screen.queryByRole('textbox')).toBeNull() // optimistic close
  })

  it('Enter on a focused editable cell opens the editor; Escape cancels', () => {
    const { scroller } = renderGrid({ columns: editableCols() })
    click(scroller, 50, 48)
    fireEvent.keyDown(scroller, { key: 'Enter' })
    const ta = screen.getByRole('textbox')
    fireEvent.keyDown(ta, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('a printable key opens the editor with type-to-replace', () => {
    const { scroller } = renderGrid({ columns: editableCols() })
    click(scroller, 50, 48)
    fireEvent.keyDown(scroller, { key: 'x' })
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('x')
  })

  it('a printable key on a NON-editable focused cell opens nothing and does not swallow the key', () => {
    // c1 is not editable. The key must NOT be preventDefault()'d, or native behavior (e.g. Space
    // scrolling) is lost for no reason. fireEvent returns false iff preventDefault was called.
    const { scroller } = renderGrid({ columns: editableCols() })
    click(scroller, 150, 48) // focus c1 (non-editable)
    const notPrevented = fireEvent.keyDown(scroller, { key: ' ' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(notPrevented).toBe(true)
  })

  it('a failed commit reverts (error path runs without crashing)', async () => {
    const onCellCommit = vi.fn().mockRejectedValue(new Error('nope'))
    const { scroller } = renderGrid({ columns: editableCols(), onCellCommit })
    click(scroller, 50, 48)
    click(scroller, 50, 48)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'boom' } })
    await act(async () => {
      fireEvent.keyDown(ta, { key: 'Enter' })
      await Promise.resolve()
    })
    await waitFor(() => expect(onCellCommit).toHaveBeenCalled())
  })
})

describe('frozen zones', () => {
  const frozenCols = (): Column<Row>[] => [
    { id: 'L0', name: 'L0', width: 100, frozen: 'left', accessor: (r) => r.v },
    { id: 'L1', name: 'L1', width: 100, frozen: 'left', accessor: (r) => r.v },
    { id: 'c0', name: 'C0', width: 100, accessor: (r) => r.v },
    { id: 'c1', name: 'C1', width: 100, accessor: (r) => r.v },
    { id: 'R0', name: 'R0', width: 100, frozen: 'right', accessor: (r) => r.v },
  ]

  it('renders frozen headers', () => {
    renderGrid({ columns: frozenCols() })
    expect(screen.getByText('L0')).toBeInTheDocument()
    expect(screen.getByText('R0')).toBeInTheDocument()
  })

  it('reorders within a frozen zone, leaving other zones untouched', () => {
    const onColumnOrderChange = vi.fn()
    const { scroller } = renderGrid({ columns: frozenCols(), onColumnOrderChange })
    // Grab L1 (left-zone x∈[100,200]) and drag before L0 (x≈10).
    down(scroller, 150, 16)
    move(scroller, 10, 16)
    up(scroller, 10, 16)
    expect(onColumnOrderChange).toHaveBeenCalledWith(['L1', 'L0', 'c0', 'c1', 'R0'])
  })
})

describe('drag constraints', () => {
  it('clamps a cross-zone drag to the source (center) zone', () => {
    const cols: Column<Row>[] = [
      { id: 'L0', name: 'L0', width: 100, frozen: 'left', accessor: (r) => r.v },
      { id: 'c0', name: 'C0', width: 100, accessor: (r) => r.v },
      { id: 'c1', name: 'C1', width: 100, accessor: (r) => r.v },
      { id: 'c2', name: 'C2', width: 100, accessor: (r) => r.v },
    ]
    const onColumnOrderChange = vi.fn()
    const { scroller } = renderGrid({ columns: cols, onColumnOrderChange })
    // leftBand = 100 (L0). c1 center-local x∈[100,200] → screen x∈[200,300]. Grab at 250, drag into
    // the left band (x=10) — must clamp to the center's left edge, never crossing L0.
    down(scroller, 250, 16)
    move(scroller, 10, 16)
    up(scroller, 10, 16)
    expect(onColumnOrderChange).toHaveBeenCalledWith(['L0', 'c1', 'c0', 'c2'])
  })

  it('an action column is a barrier and is itself non-grabbable', () => {
    const cols: Column<Row>[] = [
      { id: 'c0', name: 'C0', width: 100, accessor: (r) => r.v },
      { id: 'c1', name: 'C1', width: 100, accessor: (r) => r.v },
      { id: 'act', name: 'Act', width: 100, type: 'action', accessor: () => '' },
    ]
    const onColumnOrderChange = vi.fn()
    const { scroller } = renderGrid({ columns: cols, onColumnOrderChange })
    // Drag c0 far right, past the action column — must stop before `act`.
    down(scroller, 50, 16)
    move(scroller, 500, 16)
    up(scroller, 500, 16)
    expect(onColumnOrderChange).toHaveBeenCalledWith(['c1', 'c0', 'act'])

    onColumnOrderChange.mockClear()
    // Grabbing the action header (x∈[200,300]) does nothing.
    down(scroller, 250, 16)
    move(scroller, 50, 16)
    up(scroller, 50, 16)
    expect(onColumnOrderChange).not.toHaveBeenCalled()
  })
})

describe('drag-select', () => {
  it('dragging across cells selects a range (anchor → focus)', () => {
    const onSel = vi.fn()
    const { scroller } = renderGrid({ onSelectionChange: onSel })
    down(scroller, 50, 48) // c0 r0
    move(scroller, 250, 112) // c2 r2 — crosses cells → drag-select
    up(scroller, 250, 112)
    const sel = lastSelection(onSel)
    expect(sel.range!.anchor).toEqual({ rowIndex: 0, columnId: 'c0' })
    expect(sel.range!.focus).toEqual({ rowIndex: 2, columnId: 'c2' })
  })

  it('clicking a frozen-right cell focuses it (right-zone hit)', () => {
    const onSel = vi.fn()
    const cols: Column<Row>[] = [
      { id: 'c0', name: 'C0', width: 100, accessor: (r) => r.v },
      { id: 'c1', name: 'C1', width: 100, accessor: (r) => r.v },
      { id: 'R0', name: 'R0', width: 100, frozen: 'right', accessor: (r) => r.v },
    ]
    const { scroller } = renderGrid({ columns: cols, onSelectionChange: onSel })
    // Right zone is pinned at x ≥ clientWidth(1000) − right.total(100) = 900.
    click(scroller, 950, 48)
    expect(lastSelection(onSel).focusedCell).toEqual({ rowIndex: 0, columnId: 'R0' })
  })
})

describe('editor variants', () => {
  const editable = (): Column<Row>[] => [
    { id: 'c0', name: 'C0', width: 100, accessor: (r) => r.v, editable: true },
    { id: 'c1', name: 'C1', width: 100, accessor: (r) => r.v },
  ]

  it('a select column opens a native <select> that commits on change', async () => {
    const onCellCommit = vi.fn().mockResolvedValue(undefined)
    const cols: Column<Row>[] = [
      {
        id: 'c0',
        name: 'C0',
        width: 100,
        accessor: () => 'a',
        editable: true,
        type: 'select',
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
      },
      { id: 'c1', name: 'C1', width: 100, accessor: (r) => r.v },
    ]
    const { scroller } = renderGrid({ columns: cols, onCellCommit })
    click(scroller, 50, 48)
    click(scroller, 50, 48)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'b' } })
    await waitFor(() =>
      expect(onCellCommit).toHaveBeenCalledWith(expect.objectContaining({ nextValue: 'b' })),
    )
  })

  it('Tab in the text editor commits and closes', async () => {
    const onCellCommit = vi.fn().mockResolvedValue(undefined)
    const { scroller } = renderGrid({ columns: editable(), onCellCommit })
    click(scroller, 50, 48)
    click(scroller, 50, 48)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'tabbed' } })
    fireEvent.keyDown(ta, { key: 'Tab' })
    await waitFor(() =>
      expect(onCellCommit).toHaveBeenCalledWith(expect.objectContaining({ nextValue: 'tabbed' })),
    )
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('blur commits the text editor in place', async () => {
    const onCellCommit = vi.fn().mockResolvedValue(undefined)
    const { scroller } = renderGrid({ columns: editable(), onCellCommit })
    click(scroller, 50, 48)
    click(scroller, 50, 48)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: 'blurred' } })
    fireEvent.blur(ta)
    await waitFor(() =>
      expect(onCellCommit).toHaveBeenCalledWith(expect.objectContaining({ nextValue: 'blurred' })),
    )
  })
})

describe('custom read cells', () => {
  it('renders a column’s renderRead output', () => {
    const cols: Column<Row>[] = [
      {
        id: 'c0',
        name: 'C0',
        width: 100,
        accessor: (r) => r.v,
        renderRead: (ctx) => <span data-testid="custom">★{String(ctx.value)}</span>,
      },
      { id: 'c1', name: 'C1', width: 100, accessor: (r) => r.v },
    ]
    renderGrid({ columns: cols })
    expect(screen.getAllByTestId('custom').length).toBeGreaterThan(0)
  })
})
