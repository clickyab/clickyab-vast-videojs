
(function(window, videojs) {
  'use strict';

  var iOS = /iPad|iPhone|iPod/.test(navigator.platform);

  var defaults = {
      // serverUrl: '',
      // userId: '',
      // contentId: '',
      requestUrl: '',
      option: true,
      // seconds before skip button shows, negative values to disable skip button altogether
      skipTime: 5,
      allowSkip: true,
      startOffset: 0,
      resumeSkipMidroll: false,
      debug: false
    },
    clickyabAdScheduler;

  /**
   * Initialize the plugin.
   * @param options (optional) {object} configuration for the plugin
   */
  clickyabAdScheduler = function(options) {

    var settings = videojs.mergeOptions(defaults, options);
    var player = this;

    if (player.ads === undefined) {
      videojs.log.error('[ad-scheduler] This plugin requires videojs-contrib-ads, plugin not initialized');
      return null;
    } else {
      // Initialize ads framework
      player.ads({debug: settings.debug});
    }

    if (VMAP === undefined) {
      videojs.log.error('[ad-scheduler] This plugin requires vmap-client-js, plugin not initialized');
      return null;
    }

    if (DMVAST === undefined) {
      videojs.log.error('[ad-scheduler] This plugin requires vast-client-js, plugin not initialized');
      return null;
    } else {
      if (DMVAST.client.parse === undefined) {
        videojs.log.error('[ad-scheduler] This plugin requires extra extensions managed by stevennick/vast-client-js, plugin not initialized');
        return null;
      }
    }


    //////////////////////////////////////////////////////
    /// Main Program
    //////////////////////////////////////////////////////


    var source = '';
    var requestUrl;
    var adBreaks;
    var adBreaksTimeArray = [];
    var currentAdBreak = 0;
    var inAdMode = false;
    this.inAdMode = inAdMode;
    this.hasPostroll = false;

    /**
     * Reset all objects to accept new request content.
     * @return {[type]} [description]
     */
    var resetAdStatus = function() {
      source = '';
      requestUrl = {};
      adBreaks = {};
      adBreaksTimeArray = [];
      currentAdBreak = 0;
      player.inAdMode = false;
      player.off('timeupdate', timeUpdateHandle);
      player.off('ended', offTimeUpdateHandle);
    };

    var onCompletionHandle = function(event) {
      player.trigger('onCompletion');
    };

    /**
     * Parse time offset value and return absoluted integer for insert seconds.
     * @param  {[string]} time          input time for pasrse.  vaild strings are 'start', 'end', 'n%' (0<=n<=100), 'hh:mm:ss.mmm' or '#m' (sequence)
     * @param  {[integer]} adBreakSize   Required for '#m' type, used to calculate offset position.
     * @param  {[integer]} contentLength Required for 'n%', '#m' and 'end', used to calculate vaild time. Only acceptable in seconds.
     * @return {[integer]}               Calculated time offset, in seconds.
     */
    var parseTimeOffset = function(time, adBreakSize, contentLength) {
      var value = 0;
      adBreakSize = parseInt(adBreakSize, 10);
      contentLength = parseInt(contentLength, 10);
      if (time.search(/start/) === 0) {
        value = 0;
      } else if (time.search(/end/) === 0) {
        value = -1;
      } else if (time.search(/\d+%/) === 0 && contentLength !== undefined) {
        var percent = time.match(/\d+/)[0];
        value = (percent / 100) * contentLength;
      } else if (time.search(/\d+:\d+:\d+(.\d+|)/) === 0) {
        var times = time.match(/\d+/g);
        var seconds = parseInt(times[0], 10) * 3600 + parseInt(times[1], 10) * 60 + parseInt(times[2], 10);
        if (times.length === 4) {
          seconds += parseInt(times[3], 10) / 1000;
        }
        value = seconds;
      } else if (time.search(/#\d+/) === 0 && contentLength !== undefined && adBreakSize !== undefined) {
        var position = parseInt(time.match(/\d+/)[0], 10);
        if (position === 0) {
          videojs.log.error('[ad-scheduler] Position can not be zero.');
          return -100;
        } else if (position > adBreakSize) {
          videojs.log.error('[ad-scheduler] Position value is out of AdBreaks range.');
          return -100;
        }
        value = ((position / adBreakSize) / 100) * contentLength;
      } else {
        videojs.log.error('[ad-scheduler] Error time format or not enough information to determine correct adbreak time.');
        return -100;
      }
      return value;
    };

    /**
     * This function creates a new anchor element and uses location properties (inherent)
     * to get the desired URL data. Some String operations are used (to normalize results across browsers).
     *
     * Source: http://james.padolsey.com/snippets/parsing-urls-with-the-dom/
     *
     * @param  {String} url source URL to parse.
     * @return {Object}     parsed result for futher uses.
     */
    function parseURL(url) {
      var a = document.createElement('a');
      a.href = url;
      return {
        source: url,
        protocol: a.protocol.replace(':', '').toLowerCase(),
        host: a.hostname,
        port: a.port,
        query: a.search,
        params: (function() {
          var ret = {},
            seg = a.search.replace(/^\?/, '').split('&'),
            len = seg.length,
            i = 0,
            s;
          for (; i < len; i++) {
            if (!seg[i]) {
              continue;
            }
            s = seg[i].split('=');
            ret[s[0]] = s[1];
          }
          return ret;
        })(),
        file: (a.pathname.match(/\/([^/?#]+)$/i) || [, ''])[1],
        hash: a.hash.replace('#', ''),
        path: a.pathname.replace(/^([^/])/, '/$1'),
        relative: (a.href.match(/tps?:\/\/[^/]+(.+)/) || [, ''])[1],
        segments: a.pathname.replace(/^\//, '').split('/')
      };
    }

    /**
     * Detect and merge relative URL path to correct external URL. Used in APP-based player library.
     * @param  {String} tagURI         Source URI to detect or correct.
     * @param  {Object} vmapRequestURL Parsed VMAP request URI object, as compare source
     * @return {[type]}                Corrected URL for source URI
     */
    var mergeURL = function(tagURI, vmapRequestURL) {
      var tagURL = parseURL(tagURI);
      if (tagURL.protocol === 'file') {
        // relateived href detected, replace original URL host to VMAP location

        if (!tagURL.source.startsWith('/')) {
          // relative host and path, execute additional handles to build vaild path
          var relPath = '/';
          for (var index = 0; index < vmapRequestURL.segments.length - 1; index++) {
            relPath = relPath + vmapRequestURL.segments[index] + '/';
          }
          tagURL.source = relPath + tagURL.source;
        }

        // relative host, absolute path
        if (vmapRequestURL.port === '') {
          return vmapRequestURL.protocol + '://' + vmapRequestURL.host + tagURL.source;
        } else {
          return vmapRequestURL.protocol + '://' + vmapRequestURL.host + ':' + vmapRequestURL.port + tagURL.source;
        }
      } else {
        // Use original URL
        return tagURI;
      }
    };

    // Executes when durationchange event is trigger.
    var updateLastAdBreak = function(event) {
      if (adBreaks[adBreaks.length - 1].timeOffset === 0 && source === player.currentSrc()) {
        adBreaksTimeArray[adBreaksTimeArray.length - 1] = player.duration();
        adBreaks[adBreaks.length - 1].timeOffset = adBreaksTimeArray[adBreaksTimeArray.length - 1];
      }
    };

    /**
     * Force apply offset until player is doing playback action.
     *
     * Since mobile device player will omit setTime function until source is ready and player is playing,
     * we use timeupdate event to ensure soruce is loaded and continue force seek until video is seek to desired time.
     *
     * @return {[type]} [description]
     */
    var forceOffset = function() {
      if (player.currentTime() < settings.startOffset) {
        player.currentTime(settings.startOffset);
        if (settings.debug) {
          videojs.log('[ad-scheduler] Force setup offset...');
        }
      }
      if (player.currentTime() > settings.startOffset) {
        player.off('timeupdate', forceOffset);
        settings.startOffset = 0;
        if (settings.debug) {
          videojs.log('[ad-scheduler] Complete setup offset.');
        }
      }
    };

    /**
     * Apply startOffset to player. Using together with forceOffset function.
     *
     * Note: for iOS device, we must apply 1 second delay awaiting player ready.
     *
     * @return {null}
     */
    var applyStartOffset = function() {
      // Below hacks is apply for iOS devices.
      player.one('play', function() {
        if (iOS) {
          setTimeout(function() {
            player.on('timeupdate', forceOffset);
          }, 1000);
        } else {
          player.on('timeupdate', forceOffset);
        }
      });
      // Other devices, trying to setup current Time.
      player.currentTime(settings.startOffset);
    };

    /**
     * Used to store adbreak object.
     * @param  {[type]} ads [description]
     * @return {[type]}     [description]
     */
    var vmapCallback = function(ads) {
      if (ads === null || typeof ads === 'undefined' || typeof ads.adbreaks === 'undefined' || ads.adbreaks.length === 0) {
        // Run offset once when playback.
        if (settings.startOffset > 0) {
          applyStartOffset();
        }
        player.trigger('adsready');
        return;
      }
      // parse all abreaks to determine if there has preroll AD
      // NOTE: player duration is zero until media is playing.
      var contentLength = player.duration();
      adBreaks = ads.adbreaks;
      requestUrl = parseURL(settings.requestUrl);
      // Rebuild adBreaks array in ordered.
      var __startIndex;
      var __endIndex;
      var sortedOffset = [];
      for (var index = 0; index < adBreaks.length; index++) {
        // Handle timeOffset
        adBreaks[index].timeOffset = parseTimeOffset(adBreaks[index].timeOffset, adBreaks.length, contentLength);
        if (adBreaks[index].timeOffset > -2) {
          // save key into array
          if (adBreaks[index].timeOffset === 0) {
            __startIndex = index;
          } else if (adBreaks[index].timeOffset === -1) {
            __endIndex = index;
          } else {
            // adBreaksTimeArray.push(adBreaks[index].timeOffset);
            if ((settings.startOffset > 0 && adBreaks[index].timeOffset < settings.startOffset) && settings.resumeSkipMidroll === true) {
              // Skip put midroll ADs into array.
            } else {
              sortedOffset.push(index);
            }
          }
        }
        // Initial trackingEvent
        if (adBreaks[index].trackingEvent !== null) {
          adBreaks[index].tracker = new VMAP.tracker(adBreaks[index].trackingEvent);
        }
      }
      // Insert start and end offsets
      sortedOffset.sort();
      if (__startIndex !== undefined) {
        sortedOffset.unshift(__startIndex);
      } else {
        player.trigger('nopreroll');
      }
      if (__endIndex !== undefined) {
        sortedOffset.push(__endIndex);
      } else {
        player.trigger('nopostroll');
      }

      // if (settings.debug) {
      //   videojs.log('ad-scheduler', 'Sorted :' + JSON.stringify(sortedOffset));
      // }

      // Rebuild adBreaks
      var sortedAdBreaks = [];
      for (var sortId = 0; sortId < sortedOffset.length; sortId++) {
        var offset = sortedOffset[sortId];
        sortedAdBreaks.push(adBreaks[offset]);
        adBreaksTimeArray.push(adBreaks[offset].timeOffset);
      }
      // if (settings.debug) {
      //   videojs.log('ad-scheduler', 'Original:' + JSON.stringify(adBreaks));
      // }
      adBreaks = sortedAdBreaks.slice();
      if (settings.debug) {
        videojs.log('ad-scheduler', 'Ordered: ' + JSON.stringify(adBreaks));
      }
      source = player.currentSrc();
      player.on('timeupdate', timeUpdateHandle);
      player.off('ended', onCompletionHandle);
      player.one('ended', offTimeUpdateHandle);

      if (settings.startOffset > 0 && !player.inAdMode) {
        applyStartOffset();
      }
      player.trigger('adsready');
    };

    var setNewContent = function(contentUpdate) {
      resetAdStatus();
      if (!player.inAdMode && settings.requestUrl !== undefined) {
        // Load AD URL
        // var requestUrl = settings.serverUrl + '?uid=' + encodeURIComponent(settings.userId) + "&cid=" + encodeURIComponent(settings.contentId);
        // player.on('ended', onCompletionHandle);
        var inst = VMAP.client.get(settings.requestUrl, null, vmapCallback);
      }
    };

    /**
     * Used to fetch VMAP document for AD scheduler map.
     * @param  {[type]} contentUpdate [description]
     * @return {[type]}               [description]
     */
    var contentUpdateHandle = function(contentUpdate) {
      if (player.inAdMode) {
        // Delay content update function until AD finished.
        player.one('ended', function(event) {
          setNewContent(contentUpdate);
        });
      } else {
        setNewContent(contentUpdate);
      }
    };

    /**
     * Control player to play advertisements by VAST document.
     * @param  {Object} player Player object for control
     * @param  {Object} vast   Psrsed VAST document for player use
     * @return {[type]}        [description]
     */
    var playVastAds = function(player, vast) {

      var adPlayList = [];

      for (var vindex = 0; vindex < vast.ads.length; vindex++) {
        var ad = vast.ads[vindex];

        for (var index = 0; index < ad.creatives.length; index++) {
          var creative = ad.creatives[index];
          switch (creative.type) {
            case 'linear':
              // Linear AD
              // Select available player tech for playing

              var adSource = [];
              for (var typeIndex = 0; typeIndex < creative.mediaFiles.length; typeIndex++) {
                var mediaFile = creative.mediaFiles[typeIndex];
                if(mediaFile.mimeType == 'video/mp4') {
                  adSource.push({
                    type: mediaFile.mimeType,
                    src: mediaFile.fileURL
                  });
                } else {
                  adSource.push({
                    type: "image",
                    src: mediaFile.fileURL
                  });
                }

                // TODO: Init tracker and attach events to player
              }
              // TODO: add external data (Tracker, etc...)
              adPlayList.push({
                src: adSource,
                creative: creative,
                ad: ad
              });

              break;
            case 'non-linear':
              // TODO
              break;
            case 'companion':
              // TODO
              break;
            default:
              // DO Nothing
              break;
          }
        }
      }


      // Log current states.
      var originsrc = player.currentSrc();
      var origintype = player.currentType();
      var originPos = player.currentTime();
      if (currentAdBreak === 0 && settings.startOffset > 0) {
        originPos = settings.startOffset;
      }
      // Set to start AD Mode;
      player.ads.startLinearAdMode();

      var adIndex = 0;

      var startPlayContent = function(event) {

        player.ads.endLinearAdMode();
        if(adBreaks[currentAdBreak - 1] != null && typeof adBreaks[currentAdBreak - 1] === 'undefined') {

          if (adBreaks[currentAdBreak - 1].trackingEvent != null && adBreaks[currentAdBreak - 1].trackingEvent !== "undefined") {
            adBreaks[currentAdBreak - 1].tracker.breakEnd();
          }
        }
        //setup duration change event.
        // player.one('durationchange', updateLastAdBreak);
        // player.src([{
        //   src: originsrc,
        //   type: origintype
        // }]);
        // // seeking for same tech
        // player.currentTime(originPos);

        // var forceToCurrentTime = function(event) {
        //   if (player.currentTime() < originPos) {
        //     player.currentTime(originPos);
        //   }
        //   if (player.currentTime() > originPos) {
        //     player.off('timeupdate', forceToCurrentTime);
        //     player.on('timeupdate', timeUpdateHandle);
        //     player.one('ended', offTimeUpdateHandle);
        //   }
        // };
        player.inAdMode = false;

        // Only execute auto play when playback is not end.
        // if (adBreaksTimeArray[currentAdBreak - 1] !== -1) {
        //   // execute player play.
        //   player.play().ready(function() {
        //     player.on('timeupdate', forceToCurrentTime);
        //   });
        // }
        if (adBreaksTimeArray[currentAdBreak - 1] !== -1) {
          // execute player play.
          player.play().ready(function() {
            player.on('timeupdate', timeUpdateHandle);
          });
        } else {
          player.currentTime(originPos);
          player.off('timeupdate', timeUpdateHandle);
          player.pause();
        }
      };

      var nextOrEndAd = function(event) {

        var domain_title =  document.querySelector(".domain-title");
        var shadow =  document.querySelector(".shadowOverlay");
        if (typeof(domain_title) != 'undefined' && domain_title != null) {
          domain_title.remove();
          shadow.remove();
        }



        adIndex++;
        player.trigger('vast-removed');
        player.off('adended', nextOrEndAd);
        player.off('aderror', nextOrEndAd);
        // player.trigger('adend');

        if (player.clickyabAdScheduler.blocker.parentNode) {
          player.clickyabAdScheduler.blocker.parentNode.removeChild(player.clickyabAdScheduler.blocker);
          // player.clickyabAdScheduler.blocker = undefined;
        }

        if (player.clickyabAdScheduler.skipButton.parentNode) {
          player.clickyabAdScheduler.skipButton.parentNode.removeChild(player.clickyabAdScheduler.skipButton);
          // player.clickyabAdScheduler.skipButton = undefined;
        }

        if (adIndex >= adPlayList.length) {
          // No present AD to play
          player.inAdMode = false;
          startPlayContent(event);
        } else {
          // Play AD
          startPlayAd(adPlayList[adIndex]);
        }
      };

      var setupEvents = function() {
        var errorOccurred = false;
        var eventCanPlayHandle = function() {
          player.vastTracker.load();
        };
        var eventTimeUpdateHandle = function() {
          if (isNaN(player.vastTracker.assetDuration)) {
            player.vastTracker.assetDuration = player.duration();
          }
          player.vastTracker.setProgress(player.currentTime());
        };
        var eventPauseHandle = function() {
          player.vastTracker.setPaused(true);
          player.one('play', function() {
            player.vastTracker.setPaused(false);
          });
        };
        var eventErrHandle = function() {
          DMVAST.util.track(player.vastTracker.ad.errorURLTemplates, {
            ERRORCODE: 405
          });
          errorOccurred = true;
          player.trigger('ended');
        };

        player.on('adcanplay', eventCanPlayHandle);
        player.on('adtimeupdate', eventTimeUpdateHandle);
        player.on('adpause', eventPauseHandle);
        player.on('aderror', eventErrHandle);

        player.one('vast-removed', function() {
          player.off('adpause', eventPauseHandle);
          player.off('adcanplay', eventCanPlayHandle);
          player.off('adtimeupdate', eventTimeUpdateHandle);
          player.off('aderror', eventErrHandle);
          if (!errorOccurred) {
            player.vastTracker.complete();
          }
        });
      };



      var startPlayAd = function(ado) {
        var media = null;

        player.vastTracker = new DMVAST.tracker(ado.ad, ado.creative);

        var clickthrough;
        if (player.vastTracker.clickThroughURLTemplate) {
          clickthrough = DMVAST.util.resolveURLTemplates(
            [player.vastTracker.clickThroughURLTemplate], {
              CACHEBUSTER: Math.round(Math.random() * 1.0e+10),
              CONTENTPLAYHEAD: player.vastTracker.progressFormated()
            }
          )[0];
        }

        var clicking=function(){
          window.open(clickthrough, '_blank');
        };

        var count=0;
        var forExit=setInterval(function(){
          var video = document.querySelector("video");
          if (video.webkitDisplayingFullscreen) {
            video.webkitExitFullscreen();
          }
          if(count > 5) clearInterval(forExit);
          count++;
        }, 1000);



        player.off('ended', offTimeUpdateHandle);
        player.inAdMode = true;
        if (settings.debug) {
          videojs.log('[ad-scheduler] startPlayAd with src: ' + JSON.stringify(ado.src));
        }
        var shadowOverlay = document.createElement("div");
        shadowOverlay.setAttribute("class","shadowOverlay");
        shadowOverlay.style.position = "absolute";
        shadowOverlay.style.left = "0";
        shadowOverlay.style.width = "100%";
        shadowOverlay.style.height = "60px";
        shadowOverlay.style.bottom = "0";
        shadowOverlay.style.zIndex = "999998";
        shadowOverlay.style.backgroundImage = '-moz-linear-gradient(center bottom , rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.4) 60%, rgba(0, 0, 0, 0) 99%)';
        shadowOverlay.style.backgroundImage = '-webkit-linear-gradient(bottom,rgba(0,0,0,0.5),rgba(0,0,0,0.4) 60%,rgba(0,0,0,0) 99%)';
        shadowOverlay.style.backgroundImage = '-ms-linear-gradient(center bottom , rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.4) 60%, rgba(0, 0, 0, 0) 99%)';
        shadowOverlay.style.backgroundImage = '-o-linear-gradient(center bottom , rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.4) 60%, rgba(0, 0, 0, 0) 99%)';
        shadowOverlay.style.backgroundImage = 'linear-gradient(center bottom , rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.4) 60%, rgba(0, 0, 0, 0) 99%)';

        player.el().insertBefore(shadowOverlay, player.controlBar.el());
        if(ado.src[0].type == "video/mp4") {
          player.src(ado.src);
        }
        else {
          window.setTimeout(function () {
            player.pause();
          },1);
          document.querySelector(".video-js").style.display= "block";
          var blackDiv = document.querySelector(".video-js").previousElementSibling;
          if (typeof(blackDiv) != 'undefined' && blackDiv != null) {
            blackDiv.style.display = "none";
          }

          if(navigator.userAgent.match(/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i)) {
            media=document.createElement("SPAN");
            media.setAttribute("class","image-ad");
            media.style.display="block";
            media.style.position="relative";
            media.style.zIndex="1";
            media.style.background="url('"+ado.src[0].src+"')";
            media.style.backgroundSize="100% 100%";
            media.style.width="100%";
            media.style.height="100%";
            player.el().insertBefore(media, player.controlBar.el());
          } else {
            media=document.createElement("A");
            media.setAttribute("class","image-ad");
            media.style.display="block";
            media.style.position="relative";
            media.style.zIndex="1";
            media.style.background="url('"+ado.src[0].src+"')";
            media.style.backgroundSize="100% 100%";
            media.setAttribute("href",clickthrough);
            media.setAttribute("target","_blank");
            media.style.width="100%";
            media.style.height="100%";
            player.el().insertBefore(media, player.controlBar.el());
          }
          var image_ad =  document.querySelector(".image-ad");
          if (typeof(image_ad) != 'undefined' && image_ad != null)
          {
            window.setTimeout(function () {
              document.querySelector(".image-ad").remove();
              media = null;
              player.play();
              player.trigger('adended');
              domainTitle.remove();
              shadowOverlay.remove();
            },ado.creative.duration *1000);
          }
        }



        if (player.vastTracker) {
          // player.trigger('vast-ready');
          setupEvents();
          if (settings.debug) {
            videojs.log('[ad-scheduler]', 'startPlayAd with tracker: ' + JSON.stringify(player.vastTracker.trackingEvents));
            // videojs.log('[ad-scheduler] startPlayAd with tracker');
          }
        } else {
          player.trigger('adscanceled');
        }

        // clickable AD


        if (clickthrough) {
          // click action and tracker handle
          var blocker = window.document.createElement('a');
          blocker.className = 'vast-blocker';
          blocker.href = clickthrough || '#';
          blocker.target = '_blank';
          blocker.onclick = function() {
            if (player.paused()) {
              player.play();
              return false;
            }
            var clicktrackers = player.vastTracker.clickTrackingURLTemplates;
            if (clicktrackers) {
              player.vastTracker.trackURLs(clicktrackers);
            }
            player.trigger('adclick');
          };
          player.clickyabAdScheduler.blocker = blocker;
          player.el().insertBefore(blocker, player.controlBar.el());
          // player.one('ended', function(){
          //     player.clickyabAdScheduler.blocker.parentNode.removeChild(blocker);
          // });
          // end
        }

        // skippible ad

        var domainTitle=document.createElement("A");
        var linkIcon = '<svg style="position: relative; right: -6px;top:4px;" width="16px" height="16px" viewBox="0 0 16 16" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:sketch="http://www.bohemiancoding.com/sketch/ns"><g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd" sketch:type="MSPage"><path d="M13.3333333,13.3333333 L2.66666667,13.3333333 L2.66666667,2.706375 L5.33333333,2.66666667 L5.33333333,0 L0,0 L0,16 L16,16 L16,9.33333333 L13.3333333,9.33333333 L13.3333333,13.3333333 L13.3333333,13.3333333 Z M8,0 L10.6666667,2.66666667 L6.66666667,6.66666667 L9.33333333,9.33333333 L13.3333333,5.33333333 L16,8 L16,0 L8,0 L8,0 Z" id="Shape" fill="#fff" sketch:type="MSShapeGroup"></path></g></svg>';
        domainTitle.innerHTML= linkIcon + 'مشاهده آگهی';
        if(!navigator.userAgent.match(/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i)) {
          domainTitle.href=clickthrough;
        }
        domainTitle.className="domain-title";
        domainTitle.setAttribute("target","_blank");
        domainTitle.style.textShadow = "0 2px 6px rgb(0, 0, 0.6)";
        // domainTitle.style.background = "rgba(0,0,0,0.6)";
        domainTitle.style.display = "block";
        domainTitle.style.position = "absolute";
        domainTitle.style.right = "0";
        domainTitle.style.bottom = "15px";
        domainTitle.style.textAlign = "center";
        domainTitle.style.direction = "rtl";
        domainTitle.style.color = "#ffffff";
        domainTitle.style.fontSize = "13px";
        domainTitle.style.fontWeight = "bold";
        domainTitle.style.fontFamily = "Tahoma, Arial, Helvetica, sans-serif";
        domainTitle.style.padding = "7px 10px 10px 5px";
        domainTitle.style.zIndex="9999999999";
        domainTitle.style.cursor="pointer";
        domainTitle.style.borderBottom="1px solid #fff";
        domainTitle.style.marginRight="15px";
        domainTitle.style.cursor="pointer";
        domainTitle.addEventListener("touchend",clicking);



        if (ado.src[0].type == "video/mp4") {
          var skipButton = window.document.createElement('div');
          skipButton.className = 'vast-skip-button';
          skipButton.style.display = "table";
          skipButton.style.position = "absolute";
          skipButton.style.left = "0";
          skipButton.style.bottom = "15px";
          skipButton.style.textAlign = "center";
          skipButton.style.direction = "rtl";
          skipButton.style.color = "#ffffff";
          skipButton.style.fontSize = "13px";
          skipButton.style.fontWeight = "bold";
          skipButton.style.fontFamily = "Tahoma, Arial, Helvetica, sans-serif";
          skipButton.style.padding = "7px 30px 10px 30px";
          skipButton.style.zIndex="999999";
          if (!settings.allowSkip || player.vastTracker.skipDelay === 0) {
            skipButton.style.display = 'none';
          }
          player.clickyabAdScheduler.skipButton = skipButton;
          skipButton.onclick = function(e) {
            domainTitle.remove();
            shadowOverlay.remove();
            if ((' ' + player.clickyabAdScheduler.skipButton.className + ' ').indexOf(' enabled ') >= 0) {
              // player.off('timeupdate', adTimeupdate);
              player.vastTracker.skip();
              player.pause();
              if (settings.debug) {
                videojs.log('[ad-scheduler] Ad has been skipped by user push skip button.');
              }
              player.trigger('adended');
              // player.trigger('adscanceled');
            }
            // if (window.Event.prototype.stopPropagation !== undefined) {
            //   e.stopPropagation();
            // } else {
            //   return false;
            // }
          };
        } else {
          var skipButton = window.document.createElement('div');
          skipButton.className = 'vast-skip-button';
          skipButton.style.display = "table";
          skipButton.style.position = "absolute";
          skipButton.style.left = "0";
          skipButton.style.bottom = "15px";
          skipButton.style.textAlign = "center";
          skipButton.style.direction = "rtl";
          skipButton.style.color = "#ffffff";
          skipButton.style.fontSize = "13px";
          skipButton.style.fontWeight = "bold";
          skipButton.style.fontFamily = "Tahoma, Arial, Helvetica, sans-serif";
          skipButton.style.padding = "7px 30px 10px 30px";
          skipButton.style.zIndex="999999";
          if (!settings.allowSkip || player.vastTracker.skipDelay === 0) {
            skipButton.style.display = 'none';
          }
          player.clickyabAdScheduler.skipButton = skipButton;
          skipButton.onclick = function(e) {

            if ((' ' + player.clickyabAdScheduler.skipButton.className + ' ').indexOf(' enabled ') >= 0) {
              // player.off('timeupdate', adTimeupdate);
              player.vastTracker.skip();

                window.setTimeout(function () {
                  player.play();
                },1)
              document.querySelector(".image-ad").remove();
              domainTitle.remove();
              shadowOverlay.remove();
              if (settings.debug) {
                videojs.log('[ad-scheduler] Ad has been skipped by user push skip button.');
              }
              player.trigger('adended');
              // player.trigger('adscanceled');
            }
          };
        }

        var nodes = player.el().childNodes;
        var nodeIndex;
        var controlBar;
        for (nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
          if (nodes[nodeIndex].getAttribute('class') !== 'vjs-control-bar') {
            continue;
          } else {
            controlBar = nodes[nodeIndex];
            break;
          }
        }
        player.el().insertBefore(skipButton, controlBar);
        player.el().insertBefore(domainTitle, controlBar);
        var sId;
        window.sId;
        var timeLeftImage;
        function countdown() {
          var count = parseInt(player.vastTracker.skipDelay);


          if (count < 1) {
            clearInterval(window.sId);
            var skipIcon = '<svg style="position: relative; left: 5px; top: 4px" width="16" height="16" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><polygon fill="#fff" points="2,2 28,16 2,30"/><rect fill="#fff" height="28" width="4" x="26" y="2"/></svg>';
            player.clickyabAdScheduler.skipButton.className += ' enabled';
            player.clickyabAdScheduler.skipButton.innerHTML =skipIcon + "حذف آگهی";
            player.clickyabAdScheduler.skipButton.style.cursor = 'pointer';

          } else {
            player.vastTracker.skipDelay = count -1;
            player.clickyabAdScheduler.skipButton.innerHTML =  player.vastTracker.skipDelay + ' ' + 'ثانیه تا پایان آگهی';
          }
        }

        var adTimeupdate = function(e) {
          if (ado.src[0].type == "video/mp4") {
            console.log("sedf");
            var maxDelay = settings.skipTime > player.vastTracker.skipDelay ? settings.skipTime : player.vastTracker.skipDelay;
            var timeLeft = Math.ceil(maxDelay - player.currentTime());

            if (timeLeft > 0) {
              player.clickyabAdScheduler.skipButton.innerHTML = timeLeft + ' ' + 'ثانیه تا پایان آگهی';
            } else {
              if ((' ' + player.clickyabAdScheduler.skipButton.className + ' ').indexOf(' enabled ') === -1) {
                var skipIcon = '<svg style="position: relative; left: 5px; top: 4px" width="16" height="16" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><polygon fill="#fff" points="2,2 28,16 2,30"/><rect fill="#fff" height="28" width="4" x="26" y="2"/></svg>';
                player.clickyabAdScheduler.skipButton.className += ' enabled';
                player.clickyabAdScheduler.skipButton.innerHTML = skipIcon + "حذف آگهی";
                player.clickyabAdScheduler.skipButton.style.cursor = 'pointer';
              }
            }
          } else {
            window.sId = setInterval(countdown, 1000);

          }
        };

        if (player.vastTracker.skipDelay !== null) {
          if (ado.src[0].type == "video/mp4") {

            player.on('adtimeupdate', adTimeupdate);
          } else {
            adTimeupdate();
          }
        }

        // end

        player.play();
        // player.trigger('adstart');
        player.one('adended', nextOrEndAd);
        player.one('aderror', nextOrEndAd);
      };

      if (settings.debug) {
        videojs.log('[ad-scheduler] Total ' + adPlayList.length + ' ads in this ad break.');
      }

      if (adPlayList.length === 0 && adBreaks[currentAdBreak - 1].trackingEvent !== null) {
        adBreaks[currentAdBreak - 1].tracker.error();
      }

      if (adIndex === 0 && adPlayList.length > adIndex) {
        // Start playing AD
        startPlayAd(adPlayList[adIndex]);
      } else {
        // startPlayContent()
        // Do nothing
      }
    };

    /**
     * Handle VAST parser callback.
     * @param  {[type]} vast [description]
     * @return {[type]}      [description]
     */
    var vastCallback = function(vast) {
      // Do vast related operations
      // TODO: add error handle

      // if (settings.debug) {
      //   videojs.log('[ad-scheduler] JSON.stringify(vast));
      // }
      player.pause();
      if (settings.debug) {
        videojs.log('[ad-scheduler] Play Ad break #' + (currentAdBreak + 1));
      }
      // BreakStart.
      if(adBreaks[currentAdBreak] != null && typeof adBreaks[currentAdBreak] === 'undefined') {

        if (adBreaks[currentAdBreak].trackingEvent != null && adBreaks[currentAdBreak].trackingEvent !== "undefined") {
          adBreaks[currentAdBreak].tracker.breakStart();
        }
      }
      playVastAds(player, vast);
      currentAdBreak++;
    };

    /**
     * Hook player time update event and handles midrolls & postroll ad trigger.
     * @param  {[type]} timeUpadteEvent [description]
     * @return {[type]}                 [description]
     */
    var timeUpdateHandle = function(timeUpadteEvent) {
      // Skip if in ad mode or adbreaks is empty.
      if (player.inAdMode === true || adBreaks === undefined || adBreaks[currentAdBreak] === undefined) {
        return;
      }

      if (settings.debug) {
        videojs.log('[ad-scheduler] Main content: ' + player.currentTime() + ', next trigger: ' + adBreaks[currentAdBreak].timeOffset);
      }

      // Run offset once when playback.
      if (settings.startOffset > 0) {
        player.currentTime(settings.startOffset);
        settings.startOffset = 0;
      }

      if (adBreaks[currentAdBreak].timeOffset > 0 && player.currentTime() > adBreaks[currentAdBreak].timeOffset) {
        if (settings.debug) {
          videojs.log('[ad-scheduler] Main content trigger play Ad break #' + (currentAdBreak + 1));
        }

        player.off('timeupdate', timeUpdateHandle);
        // Prepare for AD time
        if (adBreaks[currentAdBreak].isWrapper === false && adBreaks[currentAdBreak].vastAdData !== undefined) {
          player.inAdMode = true;
          DMVAST.client.parse(adBreaks[currentAdBreak].vastAdData[1], adBreaks[currentAdBreak].vastAdData[0].baseURI, null, vastCallback);
        } else if (adBreaks[currentAdBreak].isWrapper === true) {
          player.inAdMode = true;
          var url = mergeURL(adBreaks[currentAdBreak].adTagURI, requestUrl);
          if (settings.debug) {
            videojs.log('[ad-scheduler] Access URL:' + url);
          }
          DMVAST.client.get(url, null, vastCallback);
        }
      } else {
        if (adBreaks[currentAdBreak].timeOffset === -1) {
          if (settings.debug) {
            videojs.log('[ad-scheduler] Setup postroll handle');
          }
          // Stop time update handle
          player.off('timeupdate', timeUpdateHandle);
          // Setup Postroll
          this.hasPostroll = true;
          player.one('contentended', postrollHandle);
        }
      }
      // Make sure setup postroll only when there is only one ad break for postroll.
    };

    /**
     * Handle preroll advertisements.
     * @param  {[type]} event [description]
     * @return {[type]}       [description]
     */
    var prerollHandle = function(event) {
      // player.pause();
      if (settings.debug) {
        videojs.log('[ad-scheduler] Preroll triggered.');
      }
      // player.off('timeupdate', timeUpdateHandle);

      // Prepare for AD time
      if (adBreaks[currentAdBreak].isWrapper === false && adBreaks[currentAdBreak].vastAdData !== undefined) {
        player.inAdMode = true;
        DMVAST.client.parse(adBreaks[currentAdBreak].vastAdData[1], adBreaks[currentAdBreak].vastAdData[0].baseURI, null, vastCallback);
      } else if (adBreaks[currentAdBreak].isWrapper === true) {
        player.inAdMode = true;
        var url = mergeURL(adBreaks[currentAdBreak].adTagURI, requestUrl);
        if (settings.debug) {
          videojs.log('[ad-scheduler] Access URL:' + url);
        }
        DMVAST.client.get(url, null, vastCallback);
      }
    };

    /**
     * Handle postroll advertisements.
     * @param  {[type]} event [description]
     * @return {[type]}       [description]
     */
    var postrollHandle = function(event) {
      if (settings.debug) {
        videojs.log('[ad-scheduler] Postroll triggered.');
      }
      player.off('timeupdate', timeUpdateHandle);
      player.off('contentended', postrollHandle);
      this.hasPostroll = false;
      // Prepare for AD time
      if (adBreaks[currentAdBreak].isWrapper === false && adBreaks[currentAdBreak].vastAdData !== undefined) {
        player.inAdMode = true;
        DMVAST.client.parse(adBreaks[currentAdBreak].vastAdData[1], adBreaks[currentAdBreak].vastAdData[0].baseURI, null, vastCallback);
      } else if (adBreaks[currentAdBreak].isWrapper === true) {
        player.inAdMode = true;
        var url = mergeURL(adBreaks[currentAdBreak].adTagURI, requestUrl);
        if (settings.debug) {
          videojs.log('[ad-scheduler] Access URL:' + url);
        }
        DMVAST.client.get(url, null, vastCallback);
      }
    };

    var offTimeUpdateHandle = function(event) {
      if (!this.hasPostroll) {
        if (settings.debug) {
          videojs.log('[ad-scheduler] Switch off time update handle.');
        }
        player.off('timeupdate', timeUpdateHandle);
        // player.trigger('onCompletion');
      } else {
        if (settings.debug) {
          videojs.log('[ad-scheduler] Yield completion after postroll handle.');
        }
      }
    };

    // Main entry here

    // Hook time objects to determine if one of adbreak reached.
    player.on('contentupdate', contentUpdateHandle);
    player.on('readyforpreroll', prerollHandle);
    player.on('contentplayback', timeUpdateHandle);

    // replace initializer to adscheduler namespace.
    player.clickyabAdScheduler = {

      /**
       * Get current VMAP request URL or setup new VMAP request URL.
       * @param  {String} requestUrl [Option] When setup means assign new request VMAP URL to player.
       * @return {[type]}            Return current VMAP request URL if patameter is blank, or player object for chain use.
       */
      requestUrl: function(requestUrl) {
        if (!requestUrl) {
          return settings.requestUrl;
        } else {
          settings.requestUrl = requestUrl;
          return player;
        }
      },

      /**
       * Allow user skip each ad content. This option will NOT override ad break instructions defined in VAST document if ad document setup is not skippable.
       * @param  {Boolean} allowSkip True for allow AD skip, False for negative.
       * @return {[type]}           Return current settings, or player object for chain use.
       */
      allowSkip: function(allowSkip) {
        if (!allowSkip) {
          return settings.allowSkip;
        } else {
          settings.allowSkip = allowSkip;
          return player;
        }
      },

      /**
       * Allow player resume playback from given time offset, value must be in seconds. This startOffset function must call before loading actual content, otherwise, player offset may not operate corrected.
       * @param  {[integer]} offset time offset in seconds
       * @return {[type]}        Return current settings, or player object for chain use.
       */
      startOffset: function(offset) {
        if (!offset) {
          return settings.startOffset;
        } else {
          settings.startOffset = offset;
          return player;
        }
      },

      /**
       * Allow control player to skip midrolls that setup before given startOffset. Preroll advertisements will not affected by this setting. This resumeSkipMidroll function must call before loading VMAP or will still not skip midroll ads.
       * @param  {[Boolean]} option true for skip midrolls perior startoffset; false for not skip. If false, all midroll ads perior starOffset will play instantly before resume content playback.
       * @return {[type]}        Return current settings, or player object for chain use.
       */
      resumeSkipMidroll: function(option) {
        if (!option) {
          return settings.resumeSkipMidroll;
        } else {
          settings.resumeSkipMidroll = option;
          return player;
        }
      },

      /**
       * Allow user skip each ad content after ad content is played over specified seconds. This option will NOT override ad break instructions defined in VAST document if ad document setup is not skippable.
       * @param  {Integer} skipTime Waiting durations for skippable ads, in seconds.
       * @return {[type]}          Return current settings, or player object for chain use.
       */
      skipTime: function(skipDelay) {
        if (!skipDelay) {
          return settings.skipTime;
        } else {
          settings.skipTime = skipDelay;
          return player;
        }
      },

      /**
       * Update ad content instanly. Only available when Player is not in ad mode.
       * @return {Object} Player object for chain use.
       */
      contentUpdate: function() {
        contentUpdateHandle();
        return player;
      },

      /**
       * Indicate current player mode.
       * @return {Boolean} True means in AdMode and an advertisement is playing, otherwise, in normal mode.
       */
      isInAdMode: function() {
        return player.inAdMode;
      }
    };

    return this;
  };

  // register the plugin
  videojs.plugin('clickyabAdScheduler', clickyabAdScheduler);
})(window, window.videojs);
