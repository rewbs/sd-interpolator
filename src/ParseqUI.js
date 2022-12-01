import { Alert, Button, Checkbox, FormControlLabel, Tooltip as Tooltip2 } from '@mui/material';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CssBaseline from '@mui/material/CssBaseline';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import OutlinedInput from '@mui/material/OutlinedInput';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Grid from '@mui/material/Unstable_Grid2';
import { AgGridReact } from 'ag-grid-react';
import equal from 'fast-deep-equal';
import clonedeep from 'lodash.clonedeep';
import debounce from 'lodash.debounce';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Sparklines, SparklinesLine } from 'react-sparklines';
import { Roarr as log } from 'roarr';
import useDebouncedEffect from 'use-debounced-effect';
import packageJson from '../package.json';
import { DocManagerUI, loadVersion, makeDocId, saveVersion } from './DocManager';
import { Editable } from './Editable';
import { defaultInterpolation, interpret, InterpreterContext, parse } from './parseq-lang-interpreter';
import {fieldNametoRGBa} from './utils';

import 'ag-grid-community/styles/ag-grid.css'; // Core grid CSS, always needed
import 'ag-grid-community/styles/ag-theme-alpine.css'; // Optional theme CSS
import './robin.css';

// Import the functions you need from the SDKs you need
import { getAnalytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: "AIzaSyCGr7xczPkoHFQW-GanSAoAZZFGfLrYiTI",
  authDomain: "sd-parseq.firebaseapp.com",
  projectId: "sd-parseq",
  storageBucket: "sd-parseq.appspot.com",
  messagingSenderId: "830535540412",
  appId: "1:830535540412:web:858dde0a82381e6f32bab9",
  measurementId: "G-TPY8W4RQ83"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

//////////////////////////////////////////
// Config
const version = packageJson.version;

log.write = (message) => {
  console.log(message);
};

// eslint-disable-next-line
const default_prompts = {
  positive: "Cat :${prompt_weight_1} AND duck :${prompt_weight_2} AND open mouth :${prompt_weight_3} AND centered, high detail",
  negative: "low quality, artefacts, watermark, logo, signature"
}
const default_options = {
  input_fps: "",
  bpm: 140,
  output_fps: 20,
  cc_window_width: 0,
  cc_window_slide_rate: 1,
  cc_use_input: false
}

function queryStringGetOrCreate(key, creator) {
  let qps = new URLSearchParams(window.location.search);
  let val = qps.get(key);
  if (val) {
    return val;
  } else {
    val = creator();
    qps.set(key, val);
    window.history.replaceState({}, '', `${window.location.pathname}?${qps.toString()}`);
    return val;
  }
}

const GridTooltip = (props) => {
  const data = props.api.getDisplayedRowAtIndex(props.rowIndex).data;
  return (
    <div style={{ backgroundColor: '#d0ecd0' }}>
      <div>Frame: {data.frame}</div>
      <div>Seconds: {(data.frame / props.getFps()).toFixed(3)}</div>
      <div>Beat:  {(data.frame / props.getFps() / 60 * props.getBpm()).toFixed(3)}</div>
    </div>
  );
};

const ParseqUI = (props) => {
  log.debug(Date.now(), "Re-initializing ParseqUI....");

  const activeDocId = queryStringGetOrCreate('docId', makeDocId)   // Will not change unless whole page is reloaded.
  const gridRef = useRef(); 
  const interpolatable_fields = props.interpolatable_fields;
  const default_keyframes = props.default_keyframes;
  const default_displayFields = props.default_displayFields || [];
  const show_options = props.show_options;

  function fillWithDefaults(possiblyIncompleteContent) {
    if (!possiblyIncompleteContent.prompts) {
      possiblyIncompleteContent.prompts = default_prompts;
    }
    if (!possiblyIncompleteContent.keyframes) {
      possiblyIncompleteContent.keyframes = default_keyframes;
    }
    if (!possiblyIncompleteContent.displayFields) {
      possiblyIncompleteContent.displayFields = default_displayFields;
    }
    // For options we want to merge the defaults with the existing options.
    possiblyIncompleteContent.options = {...default_options, ...(possiblyIncompleteContent.options || {}) };

    return possiblyIncompleteContent;
  } 

  function freshLoadContentOfContentToState(loadedContent) {
    const filledContent = fillWithDefaults(loadedContent || {});
    setPrompts(filledContent.prompts);
    setOptions(filledContent.options);
    setDisplayFields(filledContent.displayFields);
    setKeyframes(filledContent.keyframes);
    refreshGridFromKeyframes(filledContent.keyframes);
  }

  //////////////////////////////////////////
  // App State
  //////////////////////////////////////////
  const [renderedData, setRenderedData] = useState([]);
  const [renderedErrorMessage, setRenderedErrorMessage] = useState("");
  const [lastRenderedState, setlastRenderedState] = useState("");
  const [graphAsPercentages, setGraphAsPercentages] = useState(false);
  const [keyframes, setKeyframes] = useState();
  const [displayFields, setDisplayFields] = useState();
  const [options, setOptions] = useState()
  const [prompts, setPrompts] = useState();
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [enqueuedRender, setEnqueuedRender] = useState(false);
  
  const columnDefs = useMemo(() => {
    return [
    {
      headerName: 'Frame #',
      field: 'frame',
      comparator: (valueA, valueB, nodeA, nodeB, isDescending) => valueA - valueB,
      sort: 'asc',
      valueSetter: (params) => {
        var newValue = parseInt(params.newValue);
        params.data.frame = newValue;
      },
      pinned: 'left',
    },
    ...interpolatable_fields.flatMap(field => [
      {
        field: field,
        valueSetter: (params) => {
          params.data[field] = isNaN(parseFloat(params.newValue)) ? "" : parseFloat(params.newValue);
        }
      },
      {
        headerName: '➟' + field,
        field: field + '_i',
        cellEditor: 'agLargeTextCellEditor',
        cellEditorPopup: true,
        cellEditorParams: {
          maxLength: 1000,
          rows: 2,
          cols: 50
        },
        valueSetter: (params) => {
          params.data[field + '_i'] = params.newValue;
        },
      }
    ])
  ]}, [options]);

  const defaultColDef = useMemo(() => ({
    editable: true,
    resizable: true,
    tooltipField: 'frame',
    tooltipComponent: GridTooltip,
    tooltipComponentParams: { getBpm: _ => options.bpm, getFps: _ => options.output_fps },
    suppressKeyboardEvent: (params) => {
      return params.event.ctrlKey && (
        params.event.key === 'a'
        || params.event.key === 'd'
        || params.event.key === 'r'
      );
    },
    tooltipComponent: GridTooltip,
  }), [options]);

  // Ensures that whenever any data that might affect the output changes,
  // we save the doc and notify the user that a render is required.
  // This is debounced to 200ms to avoid repeated saves if edits happen
  // in quick succession.
  useDebouncedEffect(() => {
    if (autoSaveEnabled && prompts && options && displayFields && keyframes) {
      saveVersion(activeDocId, getPersistableState());
    }
  }, 200, [prompts, options, displayFields, keyframes, autoSaveEnabled]);

  useDebouncedEffect(() => {
    if (enqueuedRender) {
      if (prompts && options && displayFields && keyframes) {
        // This is the only place we should call render explicitly.
        render();
      } else {
        // Some data was not yet initialised, render again soon.
        setTimeout(render, 100);
      }
    }
  }, 200, [enqueuedRender]);

  // Run on first load, once all react components are ready and Grid is ready.
  let runOnceTimeout = 0;
  useEffect(() => {
 
    function runOnce() {
      const qps = new URLSearchParams(window.location.search);
      const qsContent = qps.get("parseq") || qps.get("parsec");
      if (qsContent) {
        // Attempt to load content from querystring 
        // This is to support *LEGACY* parsrq URLs. Doesn't in all browsers with large data.
        freshLoadContentOfContentToState(JSON.parse(qsContent));
        const url = new URL(window.location);
        url.searchParams.delete('parsec');
        url.searchParams.delete('parseq');
        window.history.replaceState({}, '', url);
        setAutoSaveEnabled(true);
        setEnqueuedRender(true);
      } else {
        loadVersion(activeDocId).then((loadedContent) => {
          freshLoadContentOfContentToState(loadedContent);
          setAutoSaveEnabled(true);
          setEnqueuedRender(true);
        });
      }
    }
    if (gridRef.current.api) {
      clearTimeout(runOnceTimeout);
      runOnce();
    } else {
      log.debug("Couldn't do init, try again in 100ms.");
      clearTimeout(runOnceTimeout);
      runOnceTimeout = setTimeout(runOnce, 100);
    }
  }, []);


  //////////////////////////////////////////
  // Grid action callbacks 
  const addRow = useCallback((frame) => {
    if (isNaN(frame)) {
      console.error(`Invalid keyframe: ${frame}`)
      return;
    }
    while (frameToRowId(frame) !== undefined) {
      // Add frame in closest next free slot.
      ++frame;
    }
    const res = gridRef.current.api.applyTransaction({
      add: [{ "frame": frame }],
      addIndex: frame,
    });
    gridRef.current.api.onSortChanged();
    gridRef.current.api.sizeColumnsToFit();
    refreshKeyframesFromGrid();
  }, []);

  const deleteRow = useCallback((frame) => {
    if (isNaN(frame)) {
      console.error(`Invalid keyframe: ${frame}`)
      return;
    }
    if (frameToRowId(frame) === undefined) {
      console.error(`No such keyframe: ${frame}`)
      return;
    }

    if (keyframes.length <= 2) {
      console.error("There must be at least 2 keyframes. Can't delete any more.")
      return;
    }

    let rowData = gridRef.current.api.getRowNode(frameToRowId(frame)).data;
    gridRef.current.api.applyTransaction({
      remove: [rowData]
    });
    gridRef.current.api.onSortChanged();
    gridRef.current.api.sizeColumnsToFit();
    refreshKeyframesFromGrid();
  }, []);

  const onCellValueChanged = useCallback((event) => {
    gridRef.current.api.onSortChanged();
    refreshKeyframesFromGrid();
    
    // TODO - only do this if autorender is enabled.
    setEnqueuedRender(true);
  }, [gridRef]);

  const onGridReady = useCallback((params) => {
    refreshKeyframesFromGrid();
    gridRef.current.api.onSortChanged();
    gridRef.current.api.sizeColumnsToFit();
  }, [gridRef]);

  const onCellKeyPress = useCallback((e) => {
    if (e.event) {
      var keyPressed = e.event.key;
      if (keyPressed === 'a' && e.event.ctrlKey) {
        addRow(parseInt(e.node.data.frame) + 1);
      } else if (keyPressed === 'd' && e.event.ctrlKey) {
        deleteRow(parseInt(e.node.data.frame));
      } else if (keyPressed === 'r' && e.event.ctrlKey) {
        setEnqueuedRender(true);
      }
    }
  }, [gridRef]);


  // Update displayed columns when displayFields changes.
  useEffect(() => {
    if (displayFields && gridRef.current.columnApi) {
      let columnsToShow = displayFields.flatMap(c => [c, c + '_i']);
      let allColumnIds = gridRef.current.columnApi.getColumns().map((col) => col.colId)
      gridRef.current.columnApi.setColumnsVisible(allColumnIds, false);
      gridRef.current.columnApi.setColumnsVisible(columnsToShow, true);
      gridRef.current.columnApi.setColumnsVisible(['frame'], true);
      gridRef.current.api.onSortChanged();
      gridRef.current.api.sizeColumnsToFit();
    } else {
      log.debug("Couldn't update columns, try again in 100ms.");
      setTimeout(() => {
        setDisplayFields([...displayFields]);
      }, 100);
    }
  }, [displayFields]);


  //////////////////////////////////////////
  // Grid data accesss

  // Must be called whenever the grid data is changed, so that the updates
  // are reflected in other keyframe observers.
  function refreshKeyframesFromGrid() {
    console.log("Refreshing keyframes from grid...");
    let keyframes_local = [];

    if (!gridRef || !gridRef.current || !gridRef.current.api) {
      console.log("Could not refresh keyframes from grid: grid not ready.")
      setKeyframes([]);
    }
    gridRef.current.api.forEachNodeAfterFilterAndSort((rowNode, index) => {
      keyframes_local.push(rowNode.data);
    });
    setKeyframes(keyframes_local);
  }

  function refreshGridFromKeyframes(keyframes) {
    console.log("Refreshing grid from keyframes...");
    if (!gridRef || !gridRef.current || !gridRef.current.api) {
      console.log("Could not refresh grid from keyframes: grid not ready.")
      return;
    }
    gridRef.current.api.setRowData(keyframes);
  }  

  //////////////////////////////////////////
  // Other component event callbacks  
  const handleChangeDisplayFields = useCallback((e) => {
    let selectedToShow = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value
    setDisplayFields(selectedToShow);
  }, []);

  const handleChangeOption = useCallback((e) => {
    const id = e.target.id;
    let [_, optionId] = id.split(/options_/);

    const value = (optionId === 'cc_use_input') ? e.target.checked : e.target.value;
    setOptions({ ...options, [optionId]: value });

    //TODO - only do this if autorender is enabled.
    setEnqueuedRender(true);
  }, []);

  const handleChangeGraphType = useCallback((e) => {
    setGraphAsPercentages(e.target.checked);
  }, []);

  const [frameToAdd, setFrameToAdd] = useState();
  const [openAddRowDialog, setOpenAddRowDialog] = useState(false);
  const handleClickOpenAddRowDialog = () => {
    setOpenAddRowDialog(true);
  };
  const handleCloseAddRowDialog = (e) => {
    setOpenAddRowDialog(false);
    if (e.target.id === "add") {
      addRow(parseInt(frameToAdd));
    }
  };
  const addRowDialog = useMemo(() => <Dialog open={openAddRowDialog} onClose={handleCloseAddRowDialog}>
  <DialogTitle>➕ Add keyframe</DialogTitle>
  <DialogContent>
    <DialogContentText>
      Add a keyframe at the following position:
    </DialogContentText>
    <TextField
      autoFocus
      margin="dense"
      id="add_keyframe_at"
      label="Frame"
      variant="standard"
      defaultValue={frameToAdd}
      onChange={(e) => setFrameToAdd(e.target.value)}
    />
    <DialogContentText>
      <small><small>TODO: warning here if frame doesn't exist</small></small>
    </DialogContentText>
  </DialogContent>
  <DialogActions>
    <Button size="small" id="cancel_add" onClick={handleCloseAddRowDialog}>Cancel</Button>
    <Button size="small" variant="contained" id="add" onClick={handleCloseAddRowDialog}>Add</Button>
  </DialogActions>
</Dialog>, [openAddRowDialog,frameToAdd]);


  const [frameToDelete, setFrameToDelete] = useState();
  const [openDeleteRowDialog, setOpenDeleteRowDialog] = useState(false);
  const handleClickOpenDeleteRowDialog = () => {
    setOpenDeleteRowDialog(true);
  };
  const handleCloseDeleteRowDialog = (e) => {
    setOpenDeleteRowDialog(false);
    if (e.target.id === "delete") {
      deleteRow(parseInt(frameToDelete));
    }
  };

  const deleteRowDialog = useMemo(() => <Dialog open={openDeleteRowDialog} onClose={handleCloseDeleteRowDialog}>
  <DialogTitle>❌ Delete keyframe</DialogTitle>
  <DialogContent>
    <DialogContentText>
      Delete a keyframe at the following position.
    </DialogContentText>
    <TextField
      autoFocus
      margin="dense"
      id="delete_keyframe_at"
      label="Frame"
      variant="standard"
      defaultValue={frameToDelete}
      onChange={(e) => setFrameToDelete(e.target.value)}
    />
    <DialogContentText>
      <small><small>TODO: warning here if frame doesn't exist</small></small>
    </DialogContentText>
  </DialogContent>
  <DialogActions>
    <Button id="cancel_delete" onClick={handleCloseDeleteRowDialog}>Cancel</Button>
    <Button variant="contained" id="delete" onClick={handleCloseDeleteRowDialog}>Delete</Button>
  </DialogActions>
</Dialog>, [openDeleteRowDialog, frameToDelete]);
 

  // TODO: switch to useMemo that updates when elements change?
  function getPersistableState() {
    return {
      "meta": { 
        "generated_by": "sd_parseq",
        "version": version,
        "generated_at": new Date().toUTCString(),
      },
      prompts: prompts,
      options: options,
      displayFields: displayFields,
      keyframes: keyframes,
    };
  }

  const needsRender = useMemo( () => {
    return !lastRenderedState
      || !equal(lastRenderedState.keyframes, keyframes)
      || !equal(lastRenderedState.options, options)
      || !equal(lastRenderedState.prompts, prompts)
  }, [lastRenderedState, keyframes, options, prompts]);


  //////////////////////////////////////////
  // Main render action callback

  // Returns array of every frame number to render, i.e. [startFrame, ..., endFrame]
  function getAllFrameNumbersToRender() {
    var declaredFrames = [];
    gridRef.current.api.forEachNodeAfterFilterAndSort((rowNode, index) => {
      declaredFrames.push(rowNode.data.frame);
    });

    var minFrame = Math.min(...declaredFrames);
    var maxFrame = Math.max(...declaredFrames);
    return Array.from(Array(maxFrame - minFrame + 1).keys()).map((i) => i + minFrame);
  }

  const render = useCallback(debounce(() => {
    console.time('Render');
    setRenderedErrorMessage("");
    setEnqueuedRender(false);

    // Validation
    if (!keyframes) {
      log.debug("render called before initialisation complete.")
      console.timeEnd('Render');
      return;
    }
    if (keyframes.length < 2) {
      setRenderedErrorMessage("There must be at least 2 keyframes to render.")
      console.timeEnd('Render');
      return;
    }
    let firstKeyFrame = keyframes[0];
    let lastKeyFrame = keyframes[keyframes.length - 1];
    let missingFieldsFirst = [];
    let missingFieldsLast = [];
    (interpolatable_fields.concat(['frame'])).forEach((field) => {
      if (lastKeyFrame[field] === undefined || isNaN(lastKeyFrame[field]) || lastKeyFrame[field] === "") {
        missingFieldsLast.push(field)
      }
      if (firstKeyFrame[field] === undefined || isNaN(firstKeyFrame[field]) || firstKeyFrame[field] === "") {
        missingFieldsFirst.push(field)
      }
    });
    if (missingFieldsFirst.length > 0 || missingFieldsLast.length > 0) {
      setRenderedErrorMessage(`First and last frames must have values for all fields, else interpolation cannot be calculated. Missing from first frame: ${missingFieldsFirst}. Missing from last frame: ${missingFieldsLast}`);
      console.timeEnd('Render');
      return;
    }

    // Calculate actual rendered value for all interpolatable fields
    var rendered_frames = [];
    var all_frame_numbers = getAllFrameNumbersToRender();
    interpolatable_fields.forEach((field) => {
      const filtered = keyframes.filter(kf => !(kf[field] === undefined || isNaN(kf[field]) || kf[field] === ""))
      const definedFrames = filtered.map(kf => kf.frame);
      const definedValues = filtered.map(kf => Number(kf[field]))
      let lastInterpolator = f => defaultInterpolation(definedFrames, definedValues, f);

      all_frame_numbers.forEach((frame, i) => {

        let declaredRow = gridRef.current.api.getRowNode(frameToRowId(frame));
        let interpolator = lastInterpolator;

        if (declaredRow !== undefined) {
          var toParse = declaredRow.data[field + '_i'];
          if (toParse) {
            let result;
            try {
              result = parse(toParse);
            } catch (error) {
              console.error(error);
              setRenderedErrorMessage(`Error parsing interpolation for ${field} at frame ${frame} (${toParse}): ` + error);
            }
            var context = new InterpreterContext({
              fieldName: field,
              thisKf: frame,
              definedFrames: definedFrames,
              definedValues: definedValues,
              FPS: options.output_fps,
              BPM: options.bpm,
            });

            try {
              interpolator = interpret(result, context);
            } catch (error) {
              console.error(error);
              setRenderedErrorMessage(`Error interpreting interpolation for ${field} at frame ${frame} (${toParse}): ` + error);
              interpolator = lastInterpolator;
            }
          }
        }
        let computed_value = 0;
        try {
          computed_value = interpolator(frame)
        } catch (error) {
          console.error(error);
          setRenderedErrorMessage(`Error evaluating interpolation for ${field} at frame ${frame} (${toParse}): ` + error);
        }

        rendered_frames[frame] = {
          ...rendered_frames[frame] || {},
          frame: frame,
          [field]: computed_value
        }
        lastInterpolator = interpolator;
      });
    });

    // Calculate rendered prompt based on prompts and weights
    all_frame_numbers.forEach((frame) => {

      let positive_prompt = prompts.positive
        .replace(/\$\{(.*?)\}/g, (_, weight) => rendered_frames[frame][weight])
        .replace(/(\n)/g, " ");
      let negative_prompt = prompts.negative
        .replace(/\$\{(.*?)\}/g, (_, weight) => rendered_frames[frame][weight])
        .replace(/(\n)/g, " ");

      rendered_frames[frame] = {
        ...rendered_frames[frame] || {},
        positive_prompt: positive_prompt,
        negative_prompt: negative_prompt,
        deforum_prompt: `${positive_prompt} --neg ${negative_prompt}`
      }

    });

    // Calculate subseed & subseed strength based on fractional part of seed.
    all_frame_numbers.forEach((frame) => {
      let subseed = Math.ceil(rendered_frames[frame]['seed'])
      let subseed_strength = rendered_frames[frame]['seed'] % 1

      rendered_frames[frame] = {
        ...rendered_frames[frame] || {},
        subseed: subseed,
        subseed_strength: subseed_strength
      }
    });

    var rendered_frames_meta = []
    interpolatable_fields.forEach((field) => {
      let maxValue = Math.max(...rendered_frames.map(rf => Math.abs(rf[field])))
      let minValue = Math.min(...rendered_frames.map(rf => rf[field]))
      rendered_frames_meta = {
        ...rendered_frames_meta || {},
        [field] : {
          'max': maxValue,
          'min': minValue,
          'isFlat': minValue==maxValue,
        }
      }
    });

    // Calculate delta variants
    all_frame_numbers.forEach((frame) => {
      interpolatable_fields.forEach((field) => {
        let maxValue = rendered_frames_meta[field].max;

        if (frame == 0) {
          rendered_frames[frame] = {
            ...rendered_frames[frame] || {},
            [field + '_delta']: rendered_frames[0][field],
            [field + "_pc"]: (maxValue !== 0) ? rendered_frames[frame][field] / maxValue * 100 : rendered_frames[frame][field],
          }
        } else {
          rendered_frames[frame] = {
            ...rendered_frames[frame] || {},
            [field + '_delta']: (field === 'zoom') ? rendered_frames[frame][field] / rendered_frames[frame - 1][field] : rendered_frames[frame][field] - rendered_frames[frame - 1][field],
            [field + "_pc"]: (maxValue !== 0) ? rendered_frames[frame][field] / maxValue * 100 : rendered_frames[frame][field],
          }
        }
      });
    });

    const data = {
      ...getPersistableState(),
      "rendered_frames": rendered_frames,
      "rendered_frames_meta": rendered_frames_meta
    }

    setRenderedData(data);
    setlastRenderedState({
       // keyframes stores references to ag-grid rows, which will be updated as the grid changes.
       // So if we want to compare a future grid state to the last rendered state, we need to
       // do a deep copy.
      keyframes : clonedeep(keyframes),
      prompts,
      options});
    console.timeEnd('Render')
  }, 200), [keyframes, prompts, options]);

  const renderButton = useMemo(() =>
  <Button size="small" variant="contained" onClick={render}>{needsRender ? '📈 Render' : '📉 Force re-render'}</Button>,
  [prompts, needsRender, displayFields, keyframes, options]);


  const grid = useMemo(() => <>
  <div className="ag-theme-alpine" style={{ width: '100%', height: 200 }}>
    <AgGridReact
      ref={gridRef}
      rowData={default_keyframes}
      columnDefs={columnDefs}
      defaultColDef={defaultColDef}
      onCellValueChanged={onCellValueChanged}
      onCellKeyPress={onCellKeyPress}
      onGridReady={onGridReady}
      animateRows={true}
      columnHoverHighlight={true}
      undoRedoCellEditing={true}
      undoRedoCellEditingLimit={0}
      enableCellChangeFlash={true}
      tooltipShowDelay={0}
    />
    </div>
  </>, [options]);

  const getAnimatedFields = (renderedData) => {
    if (renderedData && renderedData.rendered_frames_meta) {
      return Object.keys(renderedData.rendered_frames_meta)
        .filter(field => !renderedData.rendered_frames_meta[field].isFlat)
    }
    return [];
  }

  const renderStatus = useCallback((needsRender, renderedData, renderedErrorMessage) => {
    let animated_fields = getAnimatedFields(renderedData);
    let uses2d = props.settings_2d_only.filter((field) => animated_fields.includes(field));
    let uses3d = props.settings_3d_only.filter((field) => animated_fields.includes(field));
    let message = '';
    if (uses2d.length > 0 && uses3d.length > 0) {
      message = `Note: you're animating with both 2D and 3D settings (2D:${uses2d}; 3D:${uses3d}). Some settings will have no effect depending on which Deforum animation mode you choose.`;
    } else if (uses2d.length > 0) {
      message = `Note: you're animating with 2D or pseudo-3D settings. Make sure you choose the 2D animation mode in Deforum.`;
    } else if (uses3d.length > 0) {
      message = `Note: you're 3D settings. Make sure you choose the 3D animation mode in Deforum.`;
    }

    let errorMessage = renderedErrorMessage ? <Alert severity="error">{renderedErrorMessage}</Alert> : <></>
    let statusMessage = (renderedErrorMessage || needsRender) ?
      <Alert severity="info">
        Please render to update the output.
        <span style={{float: 'right'}}>
          {renderButton}
        </span>
        <p><small>{message}</small></p>
      </Alert>
      :
      <Alert severity="success">
        Output is up-to-date.
        <span style={{float: 'right'}}>
          <CopyToClipboard text={renderedDataJsonString}>
            <Button size="small" disabled={needsRender} style={{ marginLeft: '1em' }} variant="outlined">📋 Copy</Button>
          </CopyToClipboard>
        </span>
        <p><small>{message}</small></p>        
      </Alert>;

    return <div>
      {errorMessage}
      {statusMessage}
    </div>
  });

  const docManager = useMemo(() => <DocManagerUI
    docId={activeDocId}
    onLoadContent={(content) => {
      console.log("Loading version", content);
      if (content) {
        freshLoadContentOfContentToState(content);
        setEnqueuedRender(true);
      }
    }}
  />, []);

  const frameToRowId = useCallback((frame) => {
    let id = undefined;
    gridRef.current.api.forEachNodeAfterFilterAndSort((rowNode, index) => {
      log.debug(rowNode);
      if (rowNode.data && rowNode.data.frame === frame) {
        id = rowNode.id;
        return;
      }
    });
    return id;
  }, [keyframes]);

  const optionsUI = useMemo(() => options && <div>
    <Tooltip2 title="Output Frames per Second: generate video at this frame rate. You can specify interpolators based on seconds, e.g. sin(p=1s). Parseq will use your Output FPS to convert to the correct number of frames when you render.">
      <TextField
        id={"options_output_fps"}
        label={"Output FPS"}
        defaultValue={options['output_fps']}
        onChange={handleChangeOption}
        style={{ marginBottom: '10px', marginTop: '0px' }}
        InputProps={{ style: { fontSize: '0.75em' } }}
        size="small"
        variant="standard" />
    </Tooltip2>
    <Tooltip2 title="Beats per Minute: you can specify wave interpolators based on beats, e.g. sin(p=1b). Parseq will use your BPM and Output FPS value to determine the number of frames per beat when you render.">
      <TextField
        id={"options_bpm"}
        label={"BPM"}
        defaultValue={options['bpm']}
        onChange={handleChangeOption}
        style={{ marginBottom: '10px', marginTop: '0px', marginLeft: '10px' }}
        InputProps={{ style: { fontSize: '0.75em' } }}
        size="small"
        variant="standard" />
    </Tooltip2>
  </div>, [options])

  const renderedDataJsonString = useMemo(() => renderedData && JSON.stringify(renderedData, null, 4), [renderedData]);

  const fieldSelector = useMemo(() => displayFields && <Select
    id="select-display-fields"
    label={"Show columns"}
    multiple
    value={displayFields}
    onChange={handleChangeDisplayFields}
    style={{ marginBottom: '10px', marginLeft: '10px' }}
    input={<OutlinedInput id="select-display-fields" label="Chip" />}
    size="small"
    renderValue={(selected) => (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.1 }}>
        {selected.map((value) => (
          <Chip sx={{fontSize:"0.75em"}} key={value} label={value} />
        ))}
      </Box>
    )}
    MenuProps={{
      PaperProps: {
        style: {
          maxHeight: 48 * 10 + 8, //item high * 4.5 + padding
          width: 250,
          fontSize:"0.75em"
        }
      }
    }}
  >
    {interpolatable_fields.map((field) => (
      <MenuItem
        key={field}
        value={field}
      >
        {field}
      </MenuItem>
    ))}
  </Select>, [displayFields])

  const promptsUI = useMemo(() => prompts && <>
    <Grid xs={12} container>
      <Grid xs={6}>
          <TextField
          fullWidth={true}
          id={"positive_prompt"}
          label={"Positive prompt"}
          multiline
          rows={4}
          value={prompts.positive}
          InputProps={{ style: { fontSize: '0.75em', color: 'DarkGreen' } }}
          onChange={(e) => setPrompts({ ...prompts, positive: e.target.value })}
          size="small"
          variant="standard" />
      </Grid>
      <Grid xs={6}>
        <TextField
          fullWidth={true}
          id={"negative_prompt"}
          label={"Negative prompt"}
          multiline
          rows={4}
          value={prompts.negative}
          InputProps={{ style: { fontSize: '0.75em', color: 'Firebrick' } }}
          onChange={(e) => setPrompts({ ...prompts, negative: e.target.value })}
          size="small"
          variant="standard" />
      </Grid>
    </Grid>
  
  </>, [prompts]);

  const editableGraph = useMemo(() => renderedData && <div>
    <p><small>Drag to edit keyframe values, double-click to add keyframes, shift-click to clear keyframe values.</small></p>
    <FormControlLabel control={
      <Checkbox defaultChecked={false}
        id={"graph_as_percent"}
        onChange={handleChangeGraphType}
      />}
      label="Show as percentage of max" />

    <Editable
      renderedData={renderedData}
      displayFields={displayFields}
      as_percents={graphAsPercentages}
      updateKeyframe={(field, index, value) => {
        let rowId = frameToRowId(index)
        gridRef.current.api.getRowNode(rowId).setDataValue(field, value);
        setEnqueuedRender(true);
      }}
      addKeyframe={(index) => {
        // If this isn't already a keyframe, add a keyframe
        if (frameToRowId(index) === undefined) {
          addRow(index);
          setEnqueuedRender(true);
        }
      }}
      clearKeyframe={(field, index) => {
        // If this is a keyframe, clear it
        let rowId = frameToRowId(index);
        if (rowId !== undefined) {
          gridRef.current.api.getRowNode(rowId).setDataValue(field, "");
          gridRef.current.api.getRowNode(rowId).setDataValue(field + '_i', "");
          setEnqueuedRender(true);
        }
      }}
    />
  </div>, [renderedData, displayFields, graphAsPercentages]);

  const renderSparklines =  useCallback(() => renderedData && <>
      <Grid xs={12}>
      Hiding the following because they are flat: {interpolatable_fields.filter((field) => !getAnimatedFields(renderedData).includes(field)).join(", ")}
      </Grid>
      {
        interpolatable_fields.filter((field) => getAnimatedFields(renderedData).includes(field)).map((field) =>
          <Grid xs={1} style={{ textOverflow: "ellipsis" } }>
            <span style={{ textOverflow: "ellipsis" } }><small><small><strong>{field}</strong>
              {props.settings_2d_only.includes(field) ? <Chip size="small" label="2D" variant="outlined" /> : <></>}
              {props.settings_3d_only.includes(field) ? <Chip size="small" color="primary" label="3D" variant="outlined" /> : <></>}
            </small></small></span>
            <Sparklines data={renderedData.rendered_frames.map(gf => gf[field].toFixed(5))} margin={1} padding={1}>
              <SparklinesLine style={{ stroke: fieldNametoRGBa(field, 255), fill: "none" }} />
            </Sparklines>
            <small><small><small>delta:</small></small></small>
            <Sparklines data={renderedData.rendered_frames.map(gf => gf[field + '_delta'].toFixed(5))} margin={1} padding={1}>
              <SparklinesLine style={{ stroke: fieldNametoRGBa(field, 255), fill: "none" }} />
            </Sparklines>
          </Grid>
        )
      }
    </>
    , [renderedData]);

  const renderedOutput = useMemo(() => <div>
    <TextField
      style={{ width: '100%' }}
      id="filled-multiline-static"
      label="Rendered output"
      multiline
      rows={20}
      onFocus={event => event.target.select()}
      InputProps={{ style: { fontFamily: 'Monospace', fontSize: '0.75em' } }}
      value={renderedDataJsonString}
      variant="filled"
    />
    {renderButton}
  </div>, [renderedData, needsRender]);

  //////////////////////////////////////////
  // Page
  return (
    <Grid container paddingLeft={5} paddingRight={5} spacing={2} sx={{
      '--Grid-borderWidth': '1px',
      borderTop: 'var(--Grid-borderWidth) solid',
      borderLeft: 'var(--Grid-borderWidth) solid',
      borderColor: 'divider',
      '& > div': {
        borderLeft: 'var(--Grid-borderWidth) solid',
        borderRight: 'var(--Grid-borderWidth) solid',
        borderBottom: 'var(--Grid-borderWidth) solid',
        borderColor: 'divider',
      },
    }}>
      <CssBaseline />
      <Grid xs={6}>
        {renderStatus(needsRender, renderedData, renderedErrorMessage)}
      </Grid>
      <Grid xs={6}>
        {docManager}
      </Grid>
      <Grid xs={12}>
        <h3>Prompts</h3>
        {promptsUI}
      </Grid>
      <Grid xs={12}>
        <h3>Keyframes for parameter flow</h3>
        {optionsUI}
        <small>Show fields:</small>
        {fieldSelector}
        {grid}
        <Button size="small" variant="outlined" style={{ marginRight: 10 }} onClick={handleClickOpenAddRowDialog}>➕ Add keyframe</Button>
        <Button size="small"variant="outlined" style={{ marginRight: 10 }} onClick={handleClickOpenDeleteRowDialog}>❌ Delete keyframe</Button>
        {renderButton}        
        {addRowDialog}
        {deleteRowDialog}        
      </Grid>      
      <Grid xs={12}>
        <h3>Visualised parameter flow</h3>
        {editableGraph}
      </Grid>
      <Grid xs={12}>
        <h3>Sparklines</h3>
      </Grid>        
      {renderSparklines()}
      <Grid xs={12}>
        {/* Ensures there's always a row break below sparklines. */}
      </Grid>
      <Grid xs={12}>
        <h3>Output <small><small> - copy this manifest and paste into the Parseq field in the Stable Diffusion Web UI</small></small></h3>
        {renderStatus(needsRender, renderedData, renderedErrorMessage)}
        {renderedOutput}
      </Grid>
    </Grid>
  );

};

export default ParseqUI;