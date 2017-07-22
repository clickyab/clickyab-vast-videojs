# clickyab-vast-videojs

## Client setup instruction: 

##### First load videojs :
```
 <script src="src/video.js"></script> //Videojs library
 ```
##### Then load vastjs :
 ```
 <script src="dist/videojs-vast.js"></script> //Clickyab vast library for videojs
```


##### Importing ads url :
```
var options = {
      plugins: {
        clickyabAdScheduler: {
          requestUrl: 'https://v.clickyab.com/ads/vast/?a=[YOUR_CODE]&l=[YOUR_CODE]',
          allowSkip: true
        }
      }
    };
```
##### Initial videojs
```
var player = videojs('video', options).ready(function() {
     this.src([{src:'https://www.tarafdari.com/sites/default/files/contents/user160399/video/real-madrid-3-0-atletico-madrid-hd.mp4', type:'video/mp4'}]);
     this.play();
    });
```