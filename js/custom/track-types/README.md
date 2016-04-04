A few quick notes on defining a custom track format.

+ The type name must be lowercase, e.g. beddetail despite `track type=bedDetail`

+ .parse(), .prerender(), and .render() MUST be defined.

+ .renderWithSequence() SHOULD be defined for formats that draw things based on the nucleotide sequence, which may arrive
    later than the initial render request.

+ .loadOpts() and .saveOpts() MAY be defined to handle dynamic updating of options via the Custom Track options dialog.

+ Defaults for track options can be put in .defaults.

+ The point of a format definition is to store data parsed from the track during .parse() and then draw it to a canvas
    upon a call to .render().

+ .parse() is handed an array of lines, which it can process as it likes.  It SHOULD fill .data with a convenient
    representation of the data found in the lines.  It MUST define .heights, .sizes, and .mapSizes in order for the 
    genobrowser to know what to do with the custom track.

+ To separate data retrieval and preprocessing (which can be handed off to a Web Worker to not block the UI thread)
    from drawing to the `<canvas>` and DOM operations (which unavoidably block the UI thread), .render() typically is built around
    a call to .prerender() that performs the data retrieval and preprocessing and hands off a drawSpec object to a callback.
    The callback, defined inline within .render(), is responsible for drawing everything within drawSpec to the `<canvas>`.
    drawSpec is ideally simplest set of data needed to quickly draw the image (e.g., rows of pixel positions.)

+ .prerender() can expect to access .data and all the CustomTrack.prototype methods, but not any of the DOM methods,
    since it MAY be running in a Web Worker.

+ .render() will not have access to .data or the CustomTrack.prototype methods if Web Workers are in use.
    It will always, however, have access to DOM methods.

+ .renderSequence() has access to the same object space as .render(), and MAY call .prerender() in the same fashion as
    .render(). If it has to draw certain objects *after* .render() (i.e., on top of what .render() drew), it must use the state
    of the canvas to check for this and register callbacks as necessary, since although .render() is guaranteed to be called
    before .renderSequence(), it is asynchronous and may draw things on the canvas at any time afterward. See the "bam"
    format for an example of how to do this.

+ start and end, as passed to .render(), are 1-based from the start of the genome and right-open intervals, following the 
    genobrowser convention.