import React from 'react'

import {
  ensurePluginOrder,
  defaultColumn,
  makePropGetter,
  useGetLatest,
  useMountedLayoutEffect,
  functionalUpdate,
} from '../publicUtils'

import { getFirstDefined, isFunction } from '../utils'

import * as sortTypes from '../sortTypes'

defaultColumn.sortType = 'alphanumeric'
defaultColumn.sortDescFirst = false

export const useSortBy = hooks => {
  hooks.getSortByToggleProps = [defaultGetSortByToggleProps]
  hooks.getInitialState.push(getInitialState)
  hooks.useInstance.push(useInstance)
}

useSortBy.pluginName = 'useSortBy'

const defaultGetSortByToggleProps = (props, { instance, column }) => {
  const { isMultiSortEvent = e => e.shiftKey } = instance

  return [
    props,
    {
      onClick: column.canSort
        ? e => {
            e.persist()
            column.toggleSortBy(
              undefined,
              !instance.disableMultiSort && isMultiSortEvent(e)
            )
          }
        : undefined,
      style: {
        cursor: column.canSort ? 'pointer' : undefined,
      },
      title: column.canSort ? 'Toggle SortBy' : undefined,
    },
  ]
}

function getInitialState(state) {
  return {
    sortBy: [],
    ...state,
  }
}

function useInstance(instance) {
  const {
    data,
    rows,
    flatRows,
    allColumns,
    orderByFn = defaultOrderByFn,
    sortTypes: userSortTypes,
    manualSortBy,
    defaultCanSort,
    disableSortBy,
    flatHeaders,
    state: { sortBy },
    setState,
    plugins,
    getHooks,
    autoResetSortBy = true,
  } = instance

  ensurePluginOrder(
    plugins,
    ['useFilters', 'useGlobalFilter', 'useGroupBy', 'usePivotColumns'],
    'useSortBy'
  )

  // use reference to avoid memory leak in #1608
  const getInstance = useGetLatest(instance)

  // Updates sorting based on a columnId, desc flag and multi flag
  const toggleSortBy = React.useCallback(
    (columnId, desc, multi) =>
      setState(
        old => {
          const {
            allColumns,
            disableMultiSort,
            disableSortRemove,
            disableMultiRemove,
            maxMultiSortColCount = Number.MAX_SAFE_INTEGER,
          } = getInstance()

          const { sortBy } = old

          // Find the column for this columnId
          const column = allColumns.find(d => d.id === columnId)
          const { sortDescFirst } = column

          // Find any existing sortBy for this column
          const existingSortBy = sortBy.find(d => d.id === columnId)
          const existingIndex = sortBy.findIndex(d => d.id === columnId)
          const hasDescDefined = typeof desc !== 'undefined' && desc !== null

          let newSortBy = []

          // What should we do with this sort action?
          let sortAction

          if (!disableMultiSort && multi) {
            if (existingSortBy) {
              sortAction = 'toggle'
            } else {
              sortAction = 'add'
            }
          } else {
            // Normal mode
            if (existingIndex !== sortBy.length - 1) {
              sortAction = 'replace'
            } else if (existingSortBy) {
              sortAction = 'toggle'
            } else {
              sortAction = 'replace'
            }
          }

          // Handle toggle states that will remove the sortBy
          if (
            sortAction === 'toggle' && // Must be toggling
            !disableSortRemove && // If disableSortRemove, disable in general
            !hasDescDefined && // Must not be setting desc
            (multi ? !disableMultiRemove : true) && // If multi, don't allow if disableMultiRemove
            ((existingSortBy && // Finally, detect if it should indeed be removed
              existingSortBy.desc &&
              !sortDescFirst) ||
              (!existingSortBy.desc && sortDescFirst))
          ) {
            sortAction = 'remove'
          }

          if (sortAction === 'replace') {
            newSortBy = [
              {
                id: columnId,
                desc: hasDescDefined ? desc : sortDescFirst,
              },
            ]
          } else if (sortAction === 'add') {
            newSortBy = [
              ...sortBy,
              {
                id: columnId,
                desc: hasDescDefined ? desc : sortDescFirst,
              },
            ]
            // Take latest n columns
            newSortBy.splice(0, newSortBy.length - maxMultiSortColCount)
          } else if (sortAction === 'toggle') {
            // This flips (or sets) the
            newSortBy = sortBy.map(d => {
              if (d.id === columnId) {
                return {
                  ...d,
                  desc: hasDescDefined ? desc : !existingSortBy.desc,
                }
              }
              return d
            })
          } else if (sortAction === 'remove') {
            newSortBy = sortBy.filter(d => d.id !== columnId)
          }

          return {
            ...old,
            sortBy: newSortBy,
          }
        },
        {
          type: 'toggleSortBy',
          columnId,
          desc,
          multi,
        }
      ),
    [getInstance, setState]
  )

  const setSortBy = React.useCallback(
    updater =>
      setState(
        old => {
          return {
            ...old,
            sortBy: functionalUpdate(updater, old.sortBy),
          }
        },
        {
          type: 'setSortBy',
        }
      ),
    [setState]
  )

  const resetSortBy = React.useCallback(
    () =>
      setState(
        old => {
          return {
            ...old,
            sortBy: getInstance().initialState.sortBy || [],
          }
        },
        {
          type: 'resetSortBy',
        }
      ),
    [getInstance, setState]
  )

  // Add the getSortByToggleProps method to columns and headers
  flatHeaders.forEach(column => {
    const {
      accessor,
      canSort: defaultColumnCanSort,
      disableSortBy: columnDisableSortBy,
      id,
    } = column

    const canSort = accessor
      ? getFirstDefined(
          columnDisableSortBy === true ? false : undefined,
          disableSortBy === true ? false : undefined,
          true
        )
      : getFirstDefined(defaultCanSort, defaultColumnCanSort, false)

    column.canSort = canSort

    if (column.canSort) {
      column.toggleSortBy = (desc, multi) =>
        toggleSortBy(column.id, desc, multi)

      column.clearSortBy = () =>
        setState(
          old => {
            const { sortBy } = old
            const newSortBy = sortBy.filter(d => d.id !== column.id)

            return {
              ...old,
              sortBy: newSortBy,
            }
          },
          {
            type: 'clearSortBy',
            columnId: column.id,
          }
        )
    }

    column.getSortByToggleProps = makePropGetter(
      getHooks().getSortByToggleProps,
      {
        instance: getInstance(),
        column,
      }
    )

    const columnSort = sortBy.find(d => d.id === id)
    column.isSorted = !!columnSort
    column.sortedIndex = sortBy.findIndex(d => d.id === id)
    column.isSortedDesc = column.isSorted ? columnSort.desc : undefined
  })

  const [sortedRows, sortedFlatRows] = React.useMemo(() => {
    if (manualSortBy || !sortBy.length) {
      return [rows, flatRows]
    }

    const sortedFlatRows = []

    // Filter out sortBys that correspond to non existing columns
    const availableSortBy = sortBy.filter(sort =>
      allColumns.find(col => col.id === sort.id)
    )

    const sortData = rows => {
      // Use the orderByFn to compose multiple sortBy's together.
      // This will also perform a stable sorting using the row index
      // if needed.
      const sortedData = orderByFn(
        rows,
        availableSortBy.map(sort => {
          // Support custom sorting methods for each column
          const column = allColumns.find(d => d.id === sort.id)

          if (!column) {
            throw new Error(
              `React-Table: Could not find a column with id: ${sort.id} while sorting`
            )
          }

          const { sortType } = column

          // Look up sortBy functions in this order:
          // column function
          // column string lookup on user sortType
          // column string lookup on built-in sortType
          // default function
          // default string lookup on user sortType
          // default string lookup on built-in sortType
          const sortMethod =
            isFunction(sortType) ||
            (userSortTypes || {})[sortType] ||
            sortTypes[sortType]

          if (!sortMethod) {
            throw new Error(
              `React-Table: Could not find a valid sortType of '${sortType}' for column '${sort.id}'.`
            )
          }

          // Return the correct sortFn.
          // This function should always return in ascending order
          return (a, b) => sortMethod(a, b, sort.id, sort.desc)
        }),
        // Map the directions
        availableSortBy.map(sort => {
          // Detect and use the sortInverted option
          const column = allColumns.find(d => d.id === sort.id)

          if (column && column.sortInverted) {
            return sort.desc
          }

          return !sort.desc
        })
      )

      // If there are sub-rows, sort them
      sortedData.forEach(row => {
        sortedFlatRows.push(row)
        if (!row.subRows || row.subRows.length <= 1) {
          return
        }
        row.subRows = sortData(row.subRows)
      })

      return sortedData
    }

    return [sortData(rows), sortedFlatRows]
  }, [
    manualSortBy,
    sortBy,
    rows,
    flatRows,
    allColumns,
    orderByFn,
    userSortTypes,
  ])

  const getAutoResetSortBy = useGetLatest(autoResetSortBy)

  useMountedLayoutEffect(() => {
    if (getAutoResetSortBy()) {
      resetSortBy()
    }
  }, [manualSortBy ? null : data])

  Object.assign(instance, {
    preSortedRows: rows,
    preSortedFlatRows: flatRows,
    sortedRows,
    sortedFlatRows,
    rows: sortedRows,
    flatRows: sortedFlatRows,
    toggleSortBy,
    setSortBy,
    resetSortBy,
  })
}

export function defaultOrderByFn(arr, funcs, dirs) {
  return [...arr].sort((rowA, rowB) => {
    for (let i = 0; i < funcs.length; i += 1) {
      const sortFn = funcs[i]
      const desc = dirs[i] === false || dirs[i] === 'desc'
      const sortInt = sortFn(rowA, rowB)
      if (sortInt !== 0) {
        return desc ? -sortInt : sortInt
      }
    }
    return dirs[0] ? rowA.index - rowB.index : rowB.index - rowA.index
  })
}
