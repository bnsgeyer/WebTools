// A js tool for analytically tuning ArduPilot vehicles using System ID log data

var DataflashParser
const import_done = import('../modules/JsDataflashParser/parser.js').then((mod) => { DataflashParser = mod.default });

// Keys in data object to run FFT of
const fft_keys = ["Tar", "Act", "Err", "P", "I", "D", "FF", "Out"]

function run_batch_fft(data_set) {

    // Window size from user
    const window_size = parseInt(document.getElementById("FFTWindow_size").value)
    if (!Number.isInteger(Math.log2(window_size))) {
        alert('Window size must be a power of two')
        throw new Error()
    }

    const num_sets = data_set.length

    // Hard code 50% overlap
    const window_overlap = 0.5
    const window_spacing = Math.round(window_size * (1 - window_overlap))

    // Get windowing function and correction factors for use later when plotting
    const windowing_function = hanning(window_size)
    const window_correction = window_correction_factors(windowing_function)

    // FFT library
    const fft = new FFTJS(window_size);

    // Calculate average sample time
    var sample_rate_sum = 0
    var sample_rate_count = 0
    for (let j=0; j<num_sets; j++) {
        if (data_set[j] == null) {
            continue
        }
        const num_batch = data_set[j].length
        for (let i=0;i<num_batch;i++) {
            if (data_set[j][i][fft_keys[0]].length < window_size) {
                // Log section is too short, skip
                continue
            }
            sample_rate_count++
            sample_rate_sum += data_set[j][i].sample_rate
        }
    }

    if (sample_rate_sum == 0) {
        // Not enough data to make up a window
        return
    }

    const sample_time = sample_rate_count / sample_rate_sum

    for (let j=0; j<num_sets; j++) {
        if (data_set[j] == null) {
            continue
        }
        let have_data = false
        const num_batch = data_set[j].length
        for (let i=0;i<num_batch;i++) {
            if (data_set[j][i].Tar.length < window_size) {
                // Log section is too short, skip
                continue
            }
            var ret = run_fft(data_set[j][i], fft_keys, window_size, window_spacing, windowing_function, fft)

            // Initialize arrays
            if (!have_data) {
                have_data = true
                data_set[j].FFT = { time: [] }
                for (const key of fft_keys) {
                    data_set[j].FFT[key] = []
                }
            }

            data_set[j].FFT.time.push(...array_offset(array_scale(ret.center, sample_time), data_set[j][i].time[0]))
            for (const key of fft_keys) {
                data_set[j].FFT[key].push(...ret[key])
            }
        }
    }

    // Get bins and other useful stuff
    data_set.FFT = { bins: rfft_freq(window_size, sample_time),
                     average_sample_rate: 1/sample_time,
                     window_size: window_size,
                     correction: window_correction }
     
}

// Get index into FFT data array
function get_axis_index() {
    for (let i = 0; i < PID_log_messages.length; i++) {
        if (document.getElementById("type_" + PID_log_messages[i].id.join("_")).checked) {
            return i
        }
    }
}

// Attempt to put page back to for a new log
function reset() {

    document.title = "ArduPilot Analytic Tune"

    const types = ["PIDP",   "PIDR",   "PIDY",
                   "PIQP",   "PIQR",   "PIQY",
                   "RATE_R", "RATE_P", "RATE_Y"]
    for (const type of types) {
        let ele = document.getElementById("type_" + type)
        ele.disabled = true
        ele.checked = false
    }

    // Clear all plot data
    for (let i = 0; i < fft_plot.data.length; i++) {
        fft_plot.data[i].x = []
        fft_plot.data[i].y = []
        fft_plot_Phase.data[i].x = []
        fft_plot_Phase.data[i].y = []
        fft_plot_Coh.data[i].x = []
        fft_plot_Coh.data[i].y = []
    }

    document.getElementById("calculate").disabled = true

    // Disable key checkboxes by default
    for (const key of fft_keys) {
        const FFT_checkbox = document.getElementById("PIDX_" + key)
        FFT_checkbox.checked = false
        FFT_checkbox.disabled = true
    }

    // Check target and actual
    document.getElementById("PIDX_Tar").checked = true
    document.getElementById("PIDX_Act").checked = true

}

// Setup plots with no data
var flight_data = {}
var fft_plot = {}
var fft_plot_Phase = {}
var fft_plot_Coh = {}
function setup_plots() {

    const time_scale_label = "Time (s)"

    // Setup flight data plot
    const flight_data_plot = ["Roll", "Pitch", "Throttle", "Altitude"]
    const flight_data_unit = ["deg",  "deg",   "",         "m"]
    flight_data.data = []
    for (let i=0;i<flight_data_plot.length;i++) {
        let axi = "y"
        if (i > 0) {
            axi += (i+1)
        }
        flight_data.data[i] = { mode: "lines",
                                name: flight_data_plot[i],
                                meta: flight_data_plot[i],
                                yaxis: axi,
                                hovertemplate: "<extra></extra>%{meta}<br>%{x:.2f} s<br>%{y:.2f} " + flight_data_unit[i] }
    }

    flight_data.layout = {
        xaxis: { title: {text: time_scale_label },
                 domain: [0.07, 0.93],
                 type: "linear", 
                 zeroline: false, 
                 showline: true, 
                 mirror: true,
                 rangeslider: {} },
        showlegend: false,
        margin: { b: 50, l: 50, r: 50, t: 20 },
    }

    const flight_data_axis_pos = [0, 0.06, 0.94, 1]
    for (let i=0;i<flight_data_plot.length;i++) {
        let axi = "yaxis"
        if (i > 0) {
            axi += (i+1)
        }
        const side = i < 2 ? "left" : "right"
        flight_data.layout[axi] = {title: { text: flight_data_plot[i] },
                                            zeroline: false,
                                            showline: true,
                                            mirror: true,
                                            side: side,
                                            position: flight_data_axis_pos[i],
                                            color: plot_default_color(i) }
        if (i > 0) {
            flight_data.layout[axi].overlaying = 'y'
        }
    }

    var plot = document.getElementById("FlightData")
    Plotly.purge(plot)
    Plotly.newPlot(plot, flight_data.data, flight_data.layout, {displaylogo: false});

    // Update start and end time based on range
    document.getElementById("FlightData").on('plotly_relayout', function(data) {

        function range_update(range) {
            document.getElementById("TimeStart").value = Math.floor(range[0])
            document.getElementById("TimeEnd").value = Math.ceil(range[1])
            if ((PID_log_messages != null) && PID_log_messages.have_data) {
                // If we have data then enable re-calculate on updated range
                document.getElementById("calculate").disabled = false
            }
        }

        if ((data['xaxis.range'] !== undefined)) {
            range_update(data['xaxis.range'])
            return
        }

        const range_keys = ['xaxis.range[0]', 'xaxis.range[1]']
        if ((data[range_keys[0]] !== undefined) && (data[range_keys[1]] !== undefined)) {
            range_update([data[range_keys[0]], data[range_keys[1]]])
            return
        }

        const auto_range_key = 'xaxis.autorange'
        if ((data[auto_range_key] !== undefined) && (data[auto_range_key] == true)) {
            range_update([PID_log_messages.start_time, PID_log_messages.end_time])
        }

    })

    amplitude_scale = get_amplitude_scale()
    frequency_scale = get_frequency_scale()

    // FFT plot setup
    fft_plot.data = []
    fft_plot_Phase.data = []
    fft_plot_Coh.data = []
    fft_plot.layout = {
        xaxis: {title: {text: frequency_scale.label }, type: "linear", zeroline: false, showline: true, mirror: true},
        yaxis: {title: {text: amplitude_scale.label }, zeroline: false, showline: true, mirror: true },
        showlegend: true,
        legend: {itemclick: false, itemdoubleclick: false },
        margin: { b: 50, l: 50, r: 50, t: 20 },
    }
    fft_plot_Phase.layout = {
        xaxis: {title: {text: frequency_scale.label }, type: "linear", zeroline: false, showline: true, mirror: true},
        yaxis: {title: "Phase (degrees)", zeroline: false, showline: true, mirror: true },
        showlegend: true,
        legend: {itemclick: false, itemdoubleclick: false },
        margin: { b: 50, l: 50, r: 50, t: 20 },
    }
    fft_plot_Coh.layout = {
        xaxis: {title: {text: frequency_scale.label }, type: "linear", zeroline: false, showline: true, mirror: true},
        yaxis: {title: "Coherence", zeroline: false, showline: true, mirror: true },
        showlegend: true,
        legend: {itemclick: false, itemdoubleclick: false },
        margin: { b: 50, l: 50, r: 50, t: 20 },
    }

    plot = document.getElementById("FFTPlotMag")
    Plotly.purge(plot)
    Plotly.newPlot(plot, fft_plot.data, fft_plot.layout, {displaylogo: false});

    plot = document.getElementById("FFTPlotPhase")
    Plotly.purge(plot)
    Plotly.newPlot(plot, fft_plot_Phase.data, fft_plot_Phase.layout, {displaylogo: false});

    plot = document.getElementById("FFTPlotCoh")
    Plotly.purge(plot)
    Plotly.newPlot(plot, fft_plot_Coh.data, fft_plot_Coh.layout, {displaylogo: false});

    //link_plots()
}


function link_plots() {

    // Clear listeners
    document.getElementById("FFTPlotMag").removeAllListeners("plotly_relayout");
    document.getElementById("FFTPlotPhase").removeAllListeners("plotly_relayout");
    document.getElementById("FFTPlotCoh").removeAllListeners("plotly_relayout");

    // Link all frequency axis
    link_plot_axis_range([["FFTPlotMag", "x", "", fft_plot],
                          ["FFTPlotPhase", "x", "", fft_plot_Phase],
                          ["FFTPlotCoh", "x", "", fft_plot_Coh]])

    // Link all reset calls
    link_plot_reset([["FFTPlotMag", fft_plot],
                     ["FFTPlotPhase", fft_plot_Phase],
                     ["FFTPlotCoh", fft_plot_Coh]])

}

// Add data sets to FFT plot
const plot_types = ["Target", "Actual", "Error", "P", "I", "D", "FF", "Output"]
function get_FFT_data_index(set_num, plot_type) {
    return set_num*plot_types.length + plot_type
}

function setup_FFT_data() {

    const PID = PID_log_messages[get_axis_index()]

    // Clear existing data
    fft_plot.data = []
    fft_plot_Phase.data = []
    fft_plot_Coh.data = []


    // Add group for each param set
    const num_sets = PID.params.sets.length
    for (let i = 0; i < num_sets; i++) {
        for (let j = 0; j < plot_types.length; j++) {
            const index = get_FFT_data_index(i, j)

            // Add set number if multiple sets
            var meta_prefix = ""
            if (num_sets > 1) {
                meta_prefix = (i+1) + " "
            }

            // For each axis
            fft_plot.data[index] = { mode: "lines",
                                     name: plot_types[j],
                                     meta: meta_prefix + plot_types[j],
                                     hovertemplate: "" }

            fft_plot_Phase.data[index] = { mode: "lines",
                                     name: plot_types[j],
                                     meta: meta_prefix + plot_types[j],
                                     hovertemplate: "" }

            fft_plot_Coh.data[index] = { mode: "lines",
                                     name: plot_types[j],
                                     meta: meta_prefix + plot_types[j],
                                     hovertemplate: "" }
          
            // Add legend groups if multiple sets
            if (num_sets > 1) {
                fft_plot.data[index].legendgroup = i
                fft_plot.data[index].legendgrouptitle =  { text: "Test " + (i+1) }
                fft_plot_Phase.data[index].legendgroup = i
                fft_plot_Phase.data[index].legendgrouptitle =  { text: "Test " + (i+1) }
                fft_plot_Coh.data[index].legendgroup = i
                fft_plot_Coh.data[index].legendgrouptitle =  { text: "Test " + (i+1) }
             }
        }
    }

    plot = document.getElementById("FFTPlotMag")
    Plotly.purge(plot)
    Plotly.newPlot(plot, fft_plot.data, fft_plot.layout, {displaylogo: false});

    plot = document.getElementById("FFTPlotPhase")
    Plotly.purge(plot)
    Plotly.newPlot(plot, fft_plot_Phase.data, fft_plot_Phase.layout, {displaylogo: false});

    plot = document.getElementById("FFTPlotCoh")
    Plotly.purge(plot)
    Plotly.newPlot(plot, fft_plot_Coh.data, fft_plot_Coh.layout, {displaylogo: false});

//    link_plots()

}

// Calculate if needed and re-draw, called from calculate button
function re_calc() {

    const start = performance.now()

    calculate()

    redraw()

    const end = performance.now();
    console.log(`Re-calc took: ${end - start} ms`);
}

// Force full re-calc on next run, on window size change
function clear_calculation() {
    if (PID_log_messages == null) {
        return
    }
    // Enable button to fix
    document.getElementById("calculate").disabled = false

    for (let i = 0; i < PID_log_messages.length; i++) {
        if ((PID_log_messages[i] == null) || (PID_log_messages[i].sets == null)) {
            continue
        }
        for (const set of PID_log_messages[i].sets) {
            if (set != null) {
                set.FFT = null
            }
        }
        PID_log_messages[i].sets.FFT = null
    }
}

// Re-run all FFT's
function calculate() {
    // Disable button, calculation is now upto date
    document.getElementById("calculate").disabled = true

    for (let i = 0; i < PID_log_messages.length; i++) {
        if (!PID_log_messages[i].have_data) {
            continue
        }
        run_batch_fft(PID_log_messages[i].sets)
    }

}

// Get configured amplitude scale
function get_amplitude_scale() {

    const use_DB = document.getElementById("ScaleLog").checked;
    const use_PSD = document.getElementById("ScalePSD").checked;

    var ret = {}
    if (use_PSD) {
        ret.fun = function (x) { return array_mul(x,x) } // x.^2
        ret.scale = function (x) { return array_scale(array_log10(x), 10.0) } // 10 * log10(x)
        ret.label = "PSD (dB/Hz)"
        ret.hover = function (axis) { return "%{" + axis + ":.2f} dB/Hz" }
        ret.window_correction = function(correction, resolution) { return ((correction.energy**2) * 0.5) / resolution }
        ret.quantization_correction = function(correction) { return 1 / (correction.energy * Math.SQRT1_2) }

    } else if (use_DB) {
        ret.fun = function (x) { return x }
        ret.scale = function (x) { return array_scale(array_log10(x), 20.0) } // 20 * log10(x)
        ret.label = "Amplitude (dB)"
        ret.hover = function (axis) { return "%{" + axis + ":.2f} dB" }
        ret.correction_scale = 1.0
        ret.window_correction = function(correction, resolution) { return correction.linear }
        ret.quantization_correction = function(correction) { return 1 / correction.linear }

    } else {
        ret.fun = function (x) { return x }
        ret.scale = function (x) { return x }
        ret.label = "Amplitude"
        ret.hover = function (axis) { return "%{" + axis + ":.2f}" }
        ret.window_correction = function(correction, resolution) { return correction.linear }
        ret.quantization_correction = function(correction) { return 1 / correction.linear }

    }

    return ret
}

// Get configured frequency scale object
function get_frequency_scale() {

    const use_RPM = document.getElementById("freq_Scale_RPM").checked;

    var ret = {}
    if (use_RPM) {
        ret.fun = function (x) { return array_scale(x, 60.0) }
        ret.label = "RPM"
        ret.hover = function (axis) { return "%{" + axis + ":.2f} RPM" }

    } else {
        ret.fun = function (x) { return x }
        ret.label = "Frequency (Hz)"
        ret.hover = function (axis) { return "%{" + axis + ":.2f} Hz" }
    }

    ret.type = document.getElementById("freq_ScaleLog").checked ? "log" : "linear"

    return ret
}

// Look through time array and return first index before start time
function find_start_index(time) {
    const start_time = parseFloat(document.getElementById("TimeStart").value)

    var start_index = 0
    for (j = 0; j<time.length; j++) {
        // Move forward start index while time is less than start time
        if (time[j] < start_time) {
            start_index = j
        }
    }
    return start_index
}

// Look through time array and return first index after end time
function find_end_index(time) {
    const end_time = parseFloat(document.getElementById("TimeEnd").value)

    var end_index = 0
    for (j = 0; j<time.length-1; j++) {
        // Move forward end index while time is less than end time
        if (time[j] <= end_time) {
            end_index = j + 1
        }
    }
    return end_index
}

function add_param_sets() {
    let fieldset = document.getElementById("test_sets")

    // Remove all children
    fieldset.replaceChildren(fieldset.children[0])

    const PID = PID_log_messages[get_axis_index()]

    // Add table
    let table = document.createElement("table")
    table.style.borderCollapse = "collapse"

    fieldset.appendChild(table)

    // Add headers
    let header = document.createElement("tr")
    table.appendChild(header)

    function set_cell_style(cell, color) {
        cell.style.border = "1px solid #000"
        cell.style.padding = "8px"
        if (color != null) {
            // add alpha, 40%
            cell.style.backgroundColor = color + '66'
        }
    }

    let index = document.createElement("th")
    header.appendChild(index)
    index.appendChild(document.createTextNode("Num"))
    set_cell_style(index)

    let item = document.createElement("th")
    header.appendChild(item)
    item.appendChild(document.createTextNode("Show"))
    set_cell_style(item)

    const names = get_PID_param_names(PID.params.prefix)
    for (const [name, param_string] of Object.entries(names)) {
        let item = document.createElement("th")
        header.appendChild(item)
        set_cell_style(item)

        item.appendChild(document.createTextNode(name.replace("_", " ")))
        item.setAttribute('title', param_string)
    }

    // Add line for each param set
    const num_sets = PID.params.sets.length

    // See how many sets are valid, if only one then the checkbox is disabled
    var valid_sets = 0
    for (let i = 0; i < num_sets; i++) {
        if ((PID.sets[i] == null) || (PID.sets[i].FFT == null)) {
            continue
        }
        valid_sets += 1
    }

    // Add line
    for (let i = 0; i < num_sets; i++) {
        const color = num_sets > 1 ? plot_default_color(i) : null
        const valid = (PID.sets[i] != null) && (PID.sets[i].FFT != null)

        const set = PID.params.sets[i]

        let row = document.createElement("tr")
        table.appendChild(row)

        let index = document.createElement("td")
        row.appendChild(index)
        set_cell_style(index, color)
        index.appendChild(document.createTextNode(i + 1))


        let item = document.createElement("td")
        row.appendChild(item)
        set_cell_style(item, color)

        let checkbox = document.createElement("input")
        checkbox.setAttribute('type', "checkbox")
        checkbox.setAttribute('id', "set_selection_" + i)
        checkbox.setAttribute('onchange', "update_hidden(this)")
        checkbox.checked = valid
        checkbox.disabled = (valid_sets == 1) || !valid
        item.appendChild(checkbox)

        for (const name of Object.keys(names)) {
            let item = document.createElement("td")
            row.appendChild(item)
            set_cell_style(item, color)

            const value = set[name]
            if (value == null) {
                continue
            }

            const text = document.createTextNode(value.toFixed(4))

            let changed = false
            if (i > 0) {
                const last_value = PID.params.sets[i-1][name]
                if (value != last_value) {
                    changed = true
                }
            }
            if (changed) {
                // Make text bold
                let bold = document.createElement("b")
                bold.appendChild(text)
                item.appendChild(bold)

            } else {
                // Just add text
                item.appendChild(text)
            }
        }
    }

    // Enable/Disable plot types as required

    // Always have target, actual and output
    document.getElementById("PIDX_Tar").disabled = false
    document.getElementById("PIDX_Act").disabled = false
    document.getElementById("PIDX_Out").disabled = false

    // Only have others from a full PID log
    const have_all = PID.id[0] !== "RATE"
    document.getElementById("PIDX_Err").disabled = !have_all
    document.getElementById("PIDX_P").disabled = !have_all
    document.getElementById("PIDX_I").disabled = !have_all
    document.getElementById("PIDX_D").disabled = !have_all
    document.getElementById("PIDX_FF").disabled = !have_all

    // Uncheck any that are disabled
    if (!have_all) {
        document.getElementById("PIDX_Err").checked = false
        document.getElementById("PIDX_P").checked = false
        document.getElementById("PIDX_I").checked = false
        document.getElementById("PIDX_D").checked = false
        document.getElementById("PIDX_FF").checked = false
    
    }


}

var amplitude_scale
var frequency_scale
function redraw() {
    if ((PID_log_messages == null) || !PID_log_messages.have_data) {
        return
    }

    const PID = PID_log_messages[get_axis_index()]

    if (PID.sets.FFT == null) {
        return
    }

    // Populate logging rate and frequency resolution
    document.getElementById("FFT_infoA").innerHTML = (PID.sets.FFT.average_sample_rate).toFixed(2)
    document.getElementById("FFT_infoB").innerHTML = (PID.sets.FFT.average_sample_rate / PID.sets.FFT.window_size).toFixed(2)

    // Graph config
    amplitude_scale = get_amplitude_scale()
    frequency_scale = get_frequency_scale()

    // Setup axes
    fft_plot.layout.xaxis.type = frequency_scale.type
    fft_plot.layout.xaxis.title.text = frequency_scale.label
    fft_plot.layout.yaxis.title.text = amplitude_scale.label

    fft_plot_Phase.layout.xaxis.type = frequency_scale.type
    fft_plot_Phase.layout.xaxis.title.text = frequency_scale.label
    fft_plot_Phase.layout.yaxis.title.text = amplitude_scale.label

    fft_plot_Coh.layout.xaxis.type = frequency_scale.type
    fft_plot_Coh.layout.xaxis.title.text = frequency_scale.label
    fft_plot_Coh.layout.yaxis.title.text = amplitude_scale.label

    const fft_hovertemplate = "<extra></extra>%{meta}<br>" + frequency_scale.hover("x") + "<br>" + amplitude_scale.hover("y")
    for (let i = 0; i < fft_plot.data.length; i++) {
        fft_plot.data[i].hovertemplate = fft_hovertemplate
        fft_plot_Phase.data[i].hovertemplate = fft_hovertemplate
        fft_plot_Coh.data[i].hovertemplate = fft_hovertemplate
    }

    // Windowing amplitude correction depends on spectrum of interest and resolution
    const FFT_resolution = PID.sets.FFT.average_sample_rate/PID.sets.FFT.window_size
    const window_correction = amplitude_scale.window_correction(PID.sets.FFT.correction, FFT_resolution)

     // Set scaled x data
    const scaled_bins = frequency_scale.fun(PID.sets.FFT.bins)

    const num_sets = PID.sets.length
    for (let i = 0; i < num_sets; i++) {
        const set = PID.sets[i]
        if ((set == null) || (set.FFT == null)) {
            continue
        }
        const show_set = document.getElementById("set_selection_" + i).checked

        // Find the start and end index
        const start_index = find_start_index(set.FFT.time)
        const end_index = find_end_index(set.FFT.time)+1

        // Number of windows averaged
        const mean_length = end_index - start_index

        var sum_in = array_mul(complex_abs(set.FFT.Tar[start_index]),complex_abs(set.FFT.Tar[start_index]))
        var sum_out = array_mul(complex_abs(set.FFT.Act[start_index]),complex_abs(set.FFT.Act[start_index]))
        var input_output = complex_mul(complex_conj(set.FFT.Tar[start_index]),set.FFT.Act[start_index])
        var real_sum_inout = input_output[0]
        var im_sum_inout = input_output[1]

        for (let k=start_index+1;k<end_index;k++) {
            // Add to sum
            var input_sqr = array_mul(complex_abs(set.FFT.Tar[k]),complex_abs(set.FFT.Tar[k]))
            var output_sqr = array_mul(complex_abs(set.FFT.Act[k]),complex_abs(set.FFT.Act[k]))
            input_output = complex_mul(complex_conj(set.FFT.Tar[k]),set.FFT.Act[k])
            sum_in = array_add(sum_in, input_sqr)  // this is now a scalar
            sum_out = array_add(sum_out, output_sqr) // this is now a scalar
            real_sum_inout = array_add(real_sum_inout, input_output[0])
            im_sum_inout = array_add(im_sum_inout, input_output[1])
        }

        Trec = 5
        fft_scale = 2 / (0.612 * mean_length * Trec)
        var input_sqr_avg = array_scale(sum_in, fft_scale)
        var output_sqr_avg = array_scale(sum_out, fft_scale)
        var input_output_avg = [array_scale(real_sum_inout, fft_scale), array_scale(im_sum_inout, fft_scale)]

        var input_sqr_inv = array_inverse(input_sqr_avg)
        const H = [array_mul(input_output_avg[0],input_sqr_inv), array_mul(input_output_avg[1],input_sqr_inv)]

        const coh_num = array_mul(complex_abs(input_output_avg),complex_abs(input_output_avg))
        const coh_den = array_mul(array_abs(input_sqr_avg), array_abs(output_sqr_avg))
        const coh = array_div(coh_num, coh_den)

        const Hmag = complex_abs(H)

        const Hphase = complex_phase(H)

        // Find the plot index
        var plot_index = get_FFT_data_index(i, 0)

        // Apply selected scale, set to y axis
        fft_plot.data[plot_index].y = amplitude_scale.scale(Hmag)
        
        // Set bins
        fft_plot.data[plot_index].x = scaled_bins

        // Work out if we should show this line
        fft_plot.data[plot_index].visible = show_set

        // Apply selected scale, set to y axis
        fft_plot_Phase.data[plot_index].y = array_scale(Hphase, 180 / Math.PI)

        // Set bins
        fft_plot_Phase.data[plot_index].x = scaled_bins

        // Work out if we should show this line
        fft_plot_Phase.data[plot_index].visible = show_set

        // Apply selected scale, set to y axis
        fft_plot_Coh.data[plot_index].y = coh

        // Set bins
        fft_plot_Coh.data[plot_index].x = scaled_bins

        // Work out if we should show this line
        fft_plot_Coh.data[plot_index].visible = show_set
    }

    Plotly.redraw("FFTPlotMag")

    Plotly.redraw("FFTPlotPhase")

    Plotly.redraw("FFTPlotCoh")

}

// Update lines that are shown in FFT plot
function update_hidden(source) {

    function set_all_from_id(id, set_to) {

        var index
        for (let j = 0; j < fft_keys.length; j++) {
            const key = fft_keys[j]
            if (id.endsWith(key)) {
                index = j
                break
            }
        }

        var i = index
        var set = 0
        while (i < fft_plot.data.length) {
            const show_set = document.getElementById("set_selection_" + set).checked
            fft_plot.data[i].visible = set_to && show_set
            i += fft_keys.length
            set += 1
        }

    }

    if (source.constructor.name == "HTMLLegendElement") {
        // Enable/disable multiple
        // Get all child checkboxes
        let checkboxes = source.parentElement.querySelectorAll("input[type=checkbox]")
        var checked = 0
        var enabled = 0
        for (let i=0; i<checkboxes.length; i++) {
            if (checkboxes[i].checked) {
                checked++
            }
            if (checkboxes[i].disabled == false) {
                enabled++
            }
        }
        // Invert the majority
        const check = checked < (enabled * 0.5)
        for (let i=0; i<checkboxes.length; i++) {
            set_all_from_id(checkboxes[i].id, check)
            checkboxes[i].checked = check
        }

    } else if (source.id.startsWith("set_selection_")) {
        const set = parseFloat(source.id.match(/\d+/g))
        const check = source.checked
        for (let j = 0; j < fft_keys.length; j++) {
            const show_key = document.getElementById("PIDX_" + fft_keys[j]).checked
            fft_plot.data[get_FFT_data_index(set, j)].visible = check && show_key
        }

    } else {
        set_all_from_id(source.id, source.checked)
    }

    Plotly.redraw("FFTPlot")

}

// Update flight data range and enable calculate when time range inputs are updated
function time_range_changed() {

    flight_data.layout.xaxis.range = [ parseFloat(document.getElementById("TimeStart").value),
                                       parseFloat(document.getElementById("TimeEnd").value)]
    flight_data.layout.xaxis.autorange = false
    Plotly.redraw("FlightData")

    document.getElementById('calculate').disabled = false
}

var last_window_size
function window_size_inc(event) {
    if (last_window_size == null) {
        last_window_size = parseFloat(event.target.defaultValue)
    }
    const new_value = parseFloat(event.target.value)
    const change = parseFloat(event.target.value) - last_window_size
    if (Math.abs(change) != 1) {
        // Assume a change of one is comming from the up down buttons, ignore angthing else
        last_window_size = new_value
        return
    }
    var new_exponent = Math.log2(last_window_size)
    if (!Number.isInteger(new_exponent)) {
        // Move to power of two in the selected direction
        new_exponent = Math.floor(new_exponent)
        if (change > 0) {
            new_exponent += 1
        }

    } else if (change > 0) {
        // Move up one
        new_exponent += 1

    } else {
        // Move down one
        new_exponent -= 1

    }
    event.target.value = 2**new_exponent
    last_window_size = event.target.value
}

function get_PID_param_names(prefix) {
    return { KP:            prefix + "P",
             KI:            prefix + "I",
             KD:            prefix + "D",
             FF:            prefix + "FF",
             I_max:         prefix + "IMAX",
             Target_filter: prefix + "FLTT",
             Error_filter:  prefix + "FLTE",
             D_filter:      prefix + "FLTD",
             Slew_max:      prefix + "SMAX"}
}

// Split use the given time array to return split points in log data
// Split at any change in parameters
// Split at any dropped data
function split_into_batches(PID_log_messages, index, time) {

    let ret = []
    const len = time.length

    // Record start and end time
    PID_log_messages[index].start_time = time[0]
    PID_log_messages[index].end_time = time[len - 1]
    if ((PID_log_messages.start_time == null) || (PID_log_messages[index].start_time < PID_log_messages.start_time)) {
        PID_log_messages.start_time = PID_log_messages[index].start_time
    }
    if ((PID_log_messages.end_time == null) || (PID_log_messages[index].end_time > PID_log_messages.end_time)) {
        PID_log_messages.end_time = PID_log_messages[index].end_time
    }

    let sample_rate_sum = 0
    let sample_rate_count = 0
    let batch_start = 0
    let count = 0
    let param_set = 0
    let set_start = PID_log_messages[index].params.sets[0].start_time
    let set_end = PID_log_messages[index].params.sets[0].end_time
    for (let j = 1; j < len; j++) {
        if (time[j] < set_start) {
            continue
        }
        // Take running average of sample time, split into batches for gaps
        // Use threshold of 5 times the average gap seen so far.
        // This should mean we get a new batch after two missed messages
        count++
        const past_set_end = time[j] > set_end
        if (((time[j] - time[j-1])*count) > ((time[j] - time[batch_start]) * 5) || (j == (len - 1)) || past_set_end) {
            if (count >= 64) {
                // Must have at least 64 samples in each batch
                const sample_rate = 1 / ((time[j-1] - time[batch_start]) / count)
                sample_rate_sum += sample_rate
                sample_rate_count++

                // Add to batch
                ret.push({param_set: param_set, sample_rate: sample_rate, batch_start: batch_start, batch_end: j-1})
            }
            if (past_set_end) {
                // Move on to next set
                param_set++
                set_start = PID_log_messages[index].params.sets[param_set].start_time
                set_end = PID_log_messages[index].params.sets[param_set].end_time
            }

            // Start the next batch from this point
            batch_start = j
            count = 0
        }

    }

    return ret
}

var PID_log_messages = []
async function load(log_file) {

    // Make sure imports are fully loaded before starting
    // This is needed when called from "open in"
    await import_done

    const start = performance.now()

    // Reset buttons and labels
    reset()

    // Reset log object                                  Copter          Plane
    PID_log_messages = [ {id: ["PIDR"],      prefixes: [ "ATC_RAT_RLL_", "RLL_RATE_"]},
                         {id: ["PIDP"],      prefixes: [ "ATC_RAT_PIT_", "PTCH_RATE_"]},
                         {id: ["PIDY"],      prefixes: [ "ATC_RAT_YAW_", "YAW_RATE_"]},
                         {id: ["PIQR"],      prefixes: [                 "Q_A_RAT_RLL_"]},
                         {id: ["PIQP"],      prefixes: [                 "Q_A_RAT_PIT_"]},
                         {id: ["PIQY"],      prefixes: [                 "Q_A_RAT_YAW_"]},
                         {id: ["RATE", "R"], prefixes: [ "ATC_RAT_RLL_", "Q_A_RAT_RLL_"]},
                         {id: ["RATE", "P"], prefixes: [ "ATC_RAT_PIT_", "Q_A_RAT_PIT_"]},
                         {id: ["RATE", "Y"], prefixes: [ "ATC_RAT_YAW_", "Q_A_RAT_YAW_"]} ]

    // Set flags for no data
    PID_log_messages.have_data = false
    for (let i = 0; i < PID_log_messages.length; i++) {
        PID_log_messages[i].have_data = false
    }

    let log = new DataflashParser()
    log.processData(log_file , [])

    open_in_update(log)

    // micro seconds to seconds helpers
    const US2S = 1 / 1000000
    function TimeUS_to_seconds(TimeUS) {
        return array_scale(TimeUS, US2S)
    }

    // Load params, split for any changes
    const PARM = log.get('PARM')
    for (let i = 0; i < PID_log_messages.length; i++) {
        PID_log_messages[i].params = { prefix: null, sets: [] }
        for (const prefix of PID_log_messages[i].prefixes) {

            const names = get_PID_param_names(prefix)

            let param_values = { start_time: 0 }
            for (const name in names) {
                param_values[name] = null
            }

            let found_param = false
            let last_set_end
            for (let j = 0; j < PARM.Name.length; j++) {
                const param_name = PARM.Name[j]
                for (const [name, param_string] of Object.entries(names)) {
                    if (param_name !== param_string) {
                        continue
                    }
                    const time = PARM.TimeUS[j] * US2S
                    const value = PARM.Value[j]
                    found_param = true
                    if (param_values[name] != null  && (param_values[name] != value)) {
                        if ((last_set_end == null) || (time - last_set_end > 1.0)) {
                            // First param change for a second
                            last_set_end = time

                            // Param change store all values to this point as a batch
                            PID_log_messages[i].params.sets.push(Object.assign({}, param_values, {end_time: last_set_end}))

                            // Record start time for new set
                            param_values.start_time = time

                        } else {
                            // Very recent param change, combine with latest set, this leaves gap between sets
                            param_values[name] = value
                            param_values.start_time = time

                        }
                    }
                    param_values[name] = value
                    break
                }
            }
            if (found_param) {
                // Push the final set
                PID_log_messages[i].params.sets.push(Object.assign({}, param_values, {end_time: Infinity}))
                PID_log_messages[i].params.prefix = prefix
                // could lock onto a set of param prefixes per vehicle to speed up the search
                break
            }
        }
    }

    // Load each log msg type
    PID_log_messages.start_time = null
    PID_log_messages.end_time = null
    for (let i = 0; i < PID_log_messages.length; i++) {
        if (PID_log_messages[i].params.prefix == null) {
            // Don't load if we don't have params
            continue
        }
        const id = PID_log_messages[i].id[0]
        if (!(id in log.messageTypes)) {
            // Dont have log message
            continue
        }
        const log_msg = log.get(id)

        const is_RATE_msg = id === "RATE"

        const time = TimeUS_to_seconds(log_msg.TimeUS)

        const batches = split_into_batches(PID_log_messages, i, time)

        if (batches.length > 0) {
            // load from batches
            PID_log_messages[i].sets = []
            for (const batch of batches) {
                if (PID_log_messages[i].sets[batch.param_set] == null) {
                    PID_log_messages[i].sets[batch.param_set] = []
                }
                if (is_RATE_msg) {
                    const axis_prefix = PID_log_messages[i].id[1]
                    // Note that is not quite the same, PID logs report the filtered target value where as RATE gets the raw
                    PID_log_messages[i].sets[batch.param_set].push({ time: time.slice(batch.batch_start, batch.batch_end),
                                                                     sample_rate: batch.sample_rate,
                                                                     Tar: Array.from(log_msg[axis_prefix + "Des"].slice(batch.batch_start, batch.batch_end)),
                                                                     Act: Array.from(log_msg[axis_prefix        ].slice(batch.batch_start, batch.batch_end)),
                                                                     Out: Array.from(log_msg[axis_prefix + "Out"].slice(batch.batch_start, batch.batch_end))})

                } else {
                    // Convert radians to degress
                    const rad2deg = 180.0 / Math.PI
                    PID_log_messages[i].sets[batch.param_set].push({ time: time.slice(batch.batch_start, batch.batch_end),
                                                                     sample_rate: batch.sample_rate,
                                                                     Tar: array_scale(Array.from(log_msg.Tar.slice(batch.batch_start, batch.batch_end)), rad2deg),
                                                                     Act: array_scale(Array.from(log_msg.Act.slice(batch.batch_start, batch.batch_end)), rad2deg),
                                                                     Err: array_scale(Array.from(log_msg.Err.slice(batch.batch_start, batch.batch_end)), rad2deg),
                                                                     P:   Array.from(log_msg.P.slice(batch.batch_start, batch.batch_end)),
                                                                     I:   Array.from(log_msg.I.slice(batch.batch_start, batch.batch_end)),
                                                                     D:   Array.from(log_msg.D.slice(batch.batch_start, batch.batch_end)),
                                                                     FF:  Array.from(log_msg.FF.slice(batch.batch_start, batch.batch_end))})
                }
            }


            // Enable UI elements
            let ele = document.getElementById("type_" + PID_log_messages[i].id.join("_"))
            ele.disabled = false
            if (!PID_log_messages.have_data) {
                // This is the first item to have data, select it
                ele.checked = true
            }

            // Set valid data flags
            PID_log_messages[i].have_data = true
            PID_log_messages.have_data = true
        }
    }

    if (!PID_log_messages.have_data) {
        alert("No PID or RATE log messages found")
        return
    }

    // Plot flight data from log
    if ("ATT" in log.messageTypes) {
        const ATT_time = TimeUS_to_seconds(log.get("ATT", "TimeUS"))
        flight_data.data[0].x = ATT_time
        flight_data.data[0].y = log.get("ATT", "Roll")

        flight_data.data[1].x = ATT_time
        flight_data.data[1].y = log.get("ATT", "Pitch")
    }


    if ("RATE" in log.messageTypes) {
        flight_data.data[2].x = TimeUS_to_seconds(log.get("RATE", "TimeUS"))
        flight_data.data[2].y = log.get("RATE", "AOut")
    }

    if ("POS" in log.messageTypes) {
        flight_data.data[3].x = TimeUS_to_seconds(log.get("POS", "TimeUS"))
        flight_data.data[3].y = log.get("POS", "RelHomeAlt")
    }

    Plotly.redraw("FlightData")

    // Caculate output
    for (var PID of PID_log_messages) {
        if (!PID.have_data) {
            continue
        }
        for (var set of PID.sets) {
            if (set == null) {
                // No data for this set
                continue
            }
            for (var batch of set) {
                if ("Out" in batch) {
                    // Have output directly from log when using RATE msg
                    continue
                }
                const len = batch.P.length
                batch.Out = new Array(len)
                for (let i = 0; i<len; i++) {
                    batch.Out[i] = batch.P[i] + batch.I[i] + batch.D[i] + batch.FF[i]
                }
            }
        }
    }

    // Update ranges of start and end time
    start_time = Math.floor(PID_log_messages.start_time)
    end_time = Math.ceil(PID_log_messages.end_time)

    var start_input = document.getElementById("TimeStart")
    start_input.disabled = false;
    start_input.min = start_time
    start_input.value = start_time
    start_input.max = end_time

    var end_input = document.getElementById("TimeEnd")
    end_input.disabled = false;
    end_input.min = start_time
    end_input.value = end_time
    end_input.max = end_time

    // Calculate FFT
    calculate()

    // Setup the selected axis
    setup_axis()

    const end = performance.now();
    console.log(`Load took: ${end - start} ms`);
}

// Setup the selected axis
function setup_axis() {

    // Show param values
    add_param_sets()

    // Setup FFT data
    setup_FFT_data()

    // Plot
    redraw()
}
