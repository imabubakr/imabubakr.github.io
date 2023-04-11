var map = new ol.Map({
  target: "map",
  layers: [
    new ol.layer.Tile({
      source: new ol.source.XYZ({
        url: "https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        attributions: 'Map data © ESRI contributors'
      })
    })
  ],
  view: new ol.View({
    center: ol.proj.fromLonLat([34.299316, 43.413029]), // Black Sea
    zoom: 4,
  }),
});

// Define the features for your career journey
var islamabad = new ol.Feature({
  geometry: new ol.geom.Point(ol.proj.fromLonLat([73.029379, 33.715907])),
  name: "BSc in Geology",
});
var pakistan = new ol.Feature({
  geometry: new ol.geom.Point(ol.proj.fromLonLat([72.990345, 33.645572])),
  name: "MSc in GIS & RS",
});
var germany = new ol.Feature({
  geometry: new ol.geom.Point(ol.proj.fromLonLat([7.842609, 47.997791])),
  name: "MSc in Geology",
});

// Create a style for each feature
var islamabadStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 10,
    fill: new ol.style.Fill({
      color: 'blue'
    }),
    stroke: new ol.style.Stroke({
      color: 'white',
      width: 2
    })
  }),
  text: new ol.style.Text({
    text: '1',
    fill: new ol.style.Fill({
      color: 'white'
    })
  })
});
var pakistanStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 10,
    fill: new ol.style.Fill({
      color: 'red'
    }),
    stroke: new ol.style.Stroke({
      color: 'white',
      width: 2
    })
  }),
  text: new ol.style.Text({
    text: '2',
    fill: new ol.style.Fill({
      color: 'white'
    })
  })
});
var germanyStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 10,
    fill: new ol.style.Fill({
      color: 'green'
    }),
    stroke: new ol.style.Stroke({
      color: 'white',
      width: 2
    })
  }),
  text: new ol.style.Text({
    text: '3',
    fill: new ol.style.Fill({
      color: 'white'
    })
  })
});

// Assign the styles to the features
islamabad.setStyle(islamabadStyle);
pakistan.setStyle(pakistanStyle);
germany.setStyle(germanyStyle);

// Create a vector layer for the features
var vectorSource = new ol.source.Vector({
  features: [islamabad, pakistan, germany],
});
var vectorLayer = new ol.layer.Vector({
  source: vectorSource,
});

// Add the vector layer to the map
map.addLayer(vectorLayer);



// Add a popup when a feature is clicked
var popup = new ol.Overlay.Popup();
map.addOverlay(popup);
map.on('click', function(event) {
  var feature = map.forEachFeatureAtPixel(event.pixel,
    function(feature, layer) {
      return feature;
    });
  if (feature) {
    popup.show(event.coordinate, '<div>' + feature.get('name') + '</div>');
  } else {
    popup.hide();
  }
});

var scaleLineControl = new ol.control.ScaleLine();
map.addControl(scaleLineControl);

var zoomSliderControl = new ol.control.ZoomSlider();
map.addControl(zoomSliderControl);


function changeImage(slideshow, n) {
  // Get all the images in the slideshow
  var images = slideshow.getElementsByTagName('img');

  // Find the currently active image
  var currentImage = slideshow.querySelector('.active');

  // Calculate the index of the next image
  var currentIndex = Array.from(images).indexOf(currentImage);
  var nextIndex = (currentIndex + n) % images.length;
  if (nextIndex < 0) {
    nextIndex = images.length - 1;
  }

  // Remove the "active" class from the current image
  currentImage.classList.remove('active');

  // Add the "active" class to the next image
  images[nextIndex].classList.add('active');
}

function enlargeSlideshow() {
  var slideshow = document.querySelector('.slideshow');
  slideshow.classList.toggle('enlarged');

  // Add an event listener to the close button to close the slideshow
  var closeButton = slideshow.querySelector('.close-button');
  closeButton.addEventListener('click', function() {
    slideshow.classList.remove('enlarged');
  });
}








