# ChromoZoom

The goal of ChromoZoom is to make genome browsing online as effortless as navigating the world on Google Maps,
while retaining the data density and customizability of UCSC's browser.

To achieve this goal, this project takes two approaches: 

- For small genomes and custom tracks: drawing data directly in the browser using [canvas][] and [SVG][]
- For larger data: stitching images from the [UCSC Genome Browser](http://genome.ucsc.edu/) into tiles

[canvas]: http://en.wikipedia.org/wiki/Canvas_element
[SVG]: http://en.wikipedia.org/wiki/Scalable_Vector_Graphics

Although the below steps will most directly guide you toward setting up your own instance of ChromoZoom,
the tiles created by the tile stitcher could conceivably power other visualizations.

## License

ChromoZoom is free for academic, nonprofit, and personal use.  The source code is licensed under the [GNU Affero General Public License v3](http://www.gnu.org/licenses/agpl-3.0.html).  In a nutshell, this license means that you are free to copy, redistribute, and modify the source code, but you are expected to provide the source for any code derived from ChromoZoom to anybody that receives the modified code or uses it over a computer network (e.g. as a web application).  ChromoZoom is not free for commercial use.  For commercial licensing, please contact the [Roth laboratory](http://llama.mshri.on.ca).

## Requirements

ChromoZoom was designed to run in a \*NIX environment and has been tested on OS X and Debian Linux.  The web interface should work in any recent version of a modern HTML5-capable web browser (Chrome, Firefox, Safari, IE ≥9).

### To serve the ChromoZoom web interface

ChromoZoom is perfectly functional out of the box for serving a web interface that can load data on small genome files (think megabase size) or custom tracks on top of genome layouts crossloaded from UCSC. You will need:

- PHP 5.x + Apache (or another webserver that can run PHP scripts)
    - Note that [magic quotes][16] must be **disabled**.
- [libcurl bindings for PHP][10] (included in OS X's default PHP install)
- If you would like to support the full range of custom tracks and genomes, you need the following on your `$PATH`, which during setup will be symlinked into a new directory in this repo called `bin/`:
    - [`tabix`][11], a generic indexer for TAB-delimited genome position files
    - [`samtools`][11], utilities for viewing for the Sequence Alignment/Map (SAM) and BAM (Binary SAM) formats
    - The following [Jim Kent binaries for big tracks][12]:
        - `bigBedInfo`
        - `bigBedSummary`
        - `bigBedToBed`
        - `bigWigSummary`
        - `bigWigInfo`
        - `twoBitToFa`

Place a checkout of this repo somewhere in your webserver's DOCROOT.  To setup the aforementioned symlinks to binaries, run `rake check` from the command line at the root of the repo.  Files under `php/` and `index.php` will need to be executable by the webserver.  Access `index.php` from a web browser to view the ChromoZoom interface.

**Note:** To view VCF/tabix or BAM files from https:// URLs, you will need to compile `tabix` and `samtools` with support for `libcurl`. See [below](#https-support-for-samtools) for details.

[10]: http://php.net/manual/en/book.curl.php
[11]: http://www.htslib.org/download/
[12]: http://hgdownload.cse.ucsc.edu/admin/exe/
[16]: http://php.net/manual/en/security.magicquotes.disabling.php

### To generate tiles

- Ruby ≥1.8.x and [rake][13].
- The [curl][14] command line tool for fetching URLs.
- The [ImageMagick][1] command line tools.  Specifically, `convert`, `identify`, and `montage`.
- Several Ruby gems, most easily acquired with a `bundle install`.
    - [nokogiri][2], an HTML manipulation library
    - [json][3]
    - [bsearch][4]
    - [htmlentities][5]

On Mac OS X with [homebrew][], this should be enough to get you started (substitute `brew` with `sudo port` for MacPorts):

    $ brew install ImageMagick
    $ sudo gem install bundler
    $ cd path/to/this/repo && bundle install

On a Debian, like Ubuntu:

    $ sudo apt-get install imagemagick curl
    $ sudo apt-get install ruby ruby1.8 rake rubygems
    $ sudo apt-get install libxslt-dev libxml2-dev
    $ sudo gem install bundler
    $ which bundle || sudo ln -s /var/lib/gems/1.8/bin/bundle /usr/local/bin/bundle
    $ cd path/to/this/repo && bundle install

If you are using Homebrew or one of the other Linuxes, [Nokogiri's instructions][1] can help you get the right libxml2 and libxslt.  Then, you will need to search your package manager for ImageMagick, Ruby, and RubyGems, and `gem install bundler` followed by `bundle install` should take you the rest of the way.

By default, the tile stitcher will scrape the [public UCSC browser](http://genome.ucsc.edu) and save files directly to the file system.  This method has significant limitations that will likely not permit the scraping of most genomes within a reasonable amount of time or disk space.  Therefore, we strongly encourage installing all of the components in **Recommended Enhancements** further down in this README.

[14]: http://curl.haxx.se
[1]: http://www.imagemagick.org/script/index.php
[2]: http://nokogiri.org/tutorials/installing_nokogiri.html
[3]: http://flori.github.com/json/doc/index.html
[4]: http://0xcc.net/ruby-bsearch/index.html.en
[5]: http://htmlentities.rubyforge.org/
[homebrew]: http://brew.sh

## Using the tile stitcher

All interactions with the tile stitcher are performed via [rake][13].  To check that you have all the above requirements, `cd` into this repo and run

    $ rake check

This will warn you about missing components that are not required, but will fail if the tools needed for tile stitching are not available.  If everything checks out, you can get started by simply typing

    $ rake

which will guide you through all the steps of selecting an available genome, creating a configuration for this genome, and grabbing tiles.  The typical workflow is as follows (replacing GENOME with the respective name of the UCSC genome database):

1. Create a YAML configuration for a genome: `rake config[GENOME]`
2. Edit the YAML configuration to your liking
3. Generate tiles according to this configuration: `rake tiles[GENOME]`
4. Generate the JSON configuration that initializes the web interface: `rake json[GENOME]`

Once you have tiles and the JSON configuration, ensure your webserver is running and open `index.php` in your web browser to see the ChromoZoom interface.

[13]: http://rake.rubyforge.org/

### Per-genome configuration

In the first step of the workflow, you create a minimal YAML configuration file for a genome using properties acquired from UCSC.  You may want to customize this file, e.g., to include or exclude certain tracks or to change the zoom levels that will be scraped.  Two example configurations have been included in this repo at `hg18.example.yaml` and `sacCer3.example.yaml`; please read their comments for details on how to customize your own.

### Using multiple workers

The third step of the workflow, or `rake tiles[GENOME]`, is usually the most time-consuming.  You can parallelize it by running multiple `rake tiles` processes at once; each process will lock the directories it is working on and therefore should be able to avoid trampling work done by others.  **NOTE:** You should only run multiple workers if you have installed a local instance of the UCSC browser as described under **[Recommended Enhancements](#installing-a-local-instance-of-the-ucsc-browser)**, otherwise you risk running afoul of UCSC's usage limits on their public site.

To launch NUMBER worker processes in a split layout of GNU `screen`, you can run

    $ rake tiles[GENOME,0,NUMBER]

You will be able to monitor what the processes are doing by their output, and terminate them if necessary by sending SIGINT to each split-screen or with `kill` from another terminal.  For more information on usage of `screen` please check your system's manpage with `man screen`.

## Recommended Enhancements

None of the following components are strictly necessary for running the ChromoZoom software; however, it is likely that you will need them to have ChromoZoom operate at scale.  In the preferable order of installation, they are:

1. A local installation of the UCSC browser
2. A Tokyo Cabinet for storing and retrieving tile images
3. Building the native extension for image processing

In addition, current release versions for `samtools` and `tabix` don't support HTTPS, but `libcurl` is being merged into the next planned release so that this is possible. To get these features now, [see below](#https-support-for-samtools).

### Installing a local instance of the UCSC browser

Installing UCSC locally is not for the faint of heart and will likely require a dedicated machine with plenty of disk space.  However, it will allow you to scrape tiles much faster than the [one hit per 15 seconds](http://genome.ucsc.edu/#Conditions) allowed by the public UCSC browser and enforced by the tile scraper.  If you modify the code to ignore this limit, you risk being banned by the public UCSC browser.

Instructions for creating a mirror of the UCSC browser are [available from UCSC](http://genome.ucsc.edu/admin/mirror.html).  Rsync'ing all the required files may take several days.  Once you have verified it is working (e.g., you can load it in a web browser), add the URL for your local install to `ucsc.yaml` under the key `browser_hosts.local`.

For maximum performance, scraping tiles directly from the machine(s) running your local genome browser allows the tile stitcher to call the CGI binaries directly, avoiding the overhead of the network, HTTP, and the Apache server.  If you can run the tile stitcher from the same machine(s) that have the kentsrc CGI binaries, set `cgi_bin_dir` in `ucsc.yaml` to the directory that contains them (e.g., `/var/www/website/cgi-bin`), then set the `scrape_method` to `cgi_bin`.  If you must run the tile stitcher from a different machine, set `cgi_bin` to `local` to scrape your local genome browser using HTTP requests to the `browser_hosts.local` address.

One significant modification we made to our local install of UCSC was to increase the maximum pixel width for images, which decreases the frequency of "seams" in genomic features at closer zoom levels.  A patch is available in `kentsrc-rothlab.patch`.  To apply it, first navigate to the root of the [kentsrc tree][15]:

    $ cd path/to/kentsrc && ls

if you're in the right place, you should see `build java python src`.  Then,

    $ patch -p0 < path/to/this/repo/kentsrc-rothlab.patch
    $ export ROTHLAB=1
    $ cd src && make clean

and re-compile and install the binaries as instructed in `src/product/README.building.source` in the Kent source tree.  Note that our additions are conditional on the `ROTHLAB` environment variable being set when running `make`, as included in the above example.

[15]: http://genome.ucsc.edu/admin/git.html

### Installing Tokyo Cabinet for tile storage

By default tiles are saved to the filesystem, but this is not recommended for production usage as many of these files will be smaller than a typical 4k filesystem block and therefore as much as 90% of your hard disk may be wasted on empty space.  Additionally, there is overhead in creating and traversing directory structures to access the tiles.  [Tokyo Cabinet][6] is a persistent, fast, and durable hashtable that increases the efficiency of storing and retrieving billions of relatively small key-value pairs.  [Tokyo Tyrant][7] provides a network interface to this hashtable that simplifies simultaneous usage by multiple processes.  ChromoZoom supports saving its scraped tiles directly to a Tokyo Cabinet hashtable (.tch) file, and retrieving them for the web interface.

To support this you must install:

- the [Tokyo Cabinet][6] and [Tokyo Tyrant][7] binaries somewhere on your `$PATH`, along with their respective libraries
- the [rufus-tokyo][8] gem (should have been installed by `bundle install`)

On OS X, the binaries are available via MacPorts in the `tokyocabinet` and `tokyotyrant` portfiles or via homebrew as `tokyo-cabinet` and `tokyo-tyrant`, but Tokyo Tyrant appears to have a bug with UNIX domain sockets.  Inconveniently, the only fix is to download the Tokyo Tyrant source [directly][7], apply [a patch][9] provided in this repo as `ttserver-macosx-socketfix.patch`, and install it over the normal binary.  So, in total:

    $ sudo port install tokyocabinet tokyotyrant
    $ cd /tmp && curl -O http://fallabs.com/tokyotyrant/tokyotyrant-1.1.41.tar.gz
    $ tar xvzf tokyotyrant-1.1.41.tar.gz
    $ cd tokyotyrant-1.1.41
    $ patch -p0 < path/to/this/repo/ttserver-macosx-socketfix.patch

Depending on whether you use homebrew or MacPorts, you might want `/usr/local` here instead.

    $ ./configure --prefix=/opt/local && make && sudo make install

If you are on Debian ≥6.0.0 "squeeze" or Ubuntu ≥10.10 "maverick" all binaries should be available as packages, so all you need is:

    $ sudo apt-get install tokyocabinet tokyotyrant

The tile stitcher will take care of starting a Tokyo Tyrant instance for each genome that you are scraping.  You will find `*.sock` UNIX domain sockets appear in `/tmp` while these servers are running.  However, in a production environment, you may wish to start these servers automatically with init scripts.

[6]: http://fallabs.com/tokyocabinet/
[7]: http://fallabs.com/tokyotyrant/
[8]: https://github.com/jmettraux/rufus-tokyo
[9]: http://actsasflinn.com/post/482955247/tokyo-tyrant-patch-unix-socket-snow-leopard

### Building the native extension for image processing

This enhancement will perhaps only make a difference if you are processing large genomes across many machines and the (very inefficient) image processing performed by the ImageMagick utilities begins to consume a significant fraction of your render time.  However, it is very easy to install.  You must have `gcc`, `make`, and the Ruby development headers to build the extension.  If you are are on Mac OS X with MacPorts, you already have all these things.  In the unlikely event that you are on Debian and don't have them, you can fix that with:

    $ sudo apt-get install build-essential ruby1.8-dev

Once you're ready to proceed, go to the root of this repo and run:

    $ rake build_native

and the files under `ext/` will be compiled into a Ruby extension suitable for your platform.  If this works, you will no longer see the "native image processing extension" warning when you start the tile stitcher.

Note that the native extension will only run if you have installed Tokyo Cabinet per the directions above.

### HTTPS support for `samtools`

This is largely cribbed from [this answer on BioStars](https://www.biostars.org/p/147772/), with the major change being that libcurl has already been merged into the development branch for htslib.

You'll first need to have `gcc`, `autoconf`, and `zlib`, `libcurl`, `openssl`, and `ncurses` with development headers. On macs, `brew install autoconf` and you should already have the rest if you have Xcode. On most Linux distros these are all in the package repo (on [Minerva](https://hpc.mssm.edu), all of these things are already installed).

Get the development version of htslib and setup the configure script:

    $ git clone https://github.com/samtools/htslib.git
    $ cd htslib/
    $ autoconf

If the last step fails with something about m4 macros, try being more forceful with `autoreconf --install`. Then configure with libcurl support and compile:

    $ ./configure --enable-libcurl
    $ make

(**Side note.** To get this to compile with a slightly older `libcurl`, such as the moderately ancient version 7.19.7 on Minerva, you may have to remove the case statement about `CURLE_NOT_BUILT_IN` from `hfile_libcurl.c`.)

Once it works, you'll find `tabix` in this directory, along with `htsfile` (which is like `file`, for sequencing formats), both with HTTPS formats. Test that it's working with

    $ ./htsfile https://hostname.example.com/path/to/some.bam

All good? Then get the source release for `samtools` 1.2:

    $ cd ..
    $ curl -LO https://github.com/samtools/samtools/releases/download/1.2/samtools-1.2.tar.bz2
    $ tar xzvf samtools-1.2.tar.bz2
    $ cd samtools-1.2

Although this includes htslib 1.2.1, you want to point it to the development version you just installed:

    $ rm -rf htslib-1.2.1
    $ ln -s ../htslib htslib-1.2.1
    $ make LDLIBS+=-lcurl LDLIBS+=-lcrypto

You should find `samtools` in this directory. Test it against some BAM file on an HTTPS server, and if you get back SAM data you're in good shape:

    $ ./samtools view https://hostname.example.com/path/to/some.bam 1:1-10000

(Note that this will spit out a `.bai` file into the current directory, which you'll want to delete.)