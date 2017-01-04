define([
  "require",
  "dojo/_base/declare",
  "dojo/_base/connect",
  "dojo/_base/lang",
  "dojo/_base/Color",
  
  "dojo/data/ItemFileReadStore",

  "dijit/_Widget",
  "dijit/_Templated",

  "dijit/form/FilteringSelect",
  "dijit/form/Button",
  "dijit/Dialog",

  "dojo/text!extras/templates/ZoomTo.html"
], function(
  require,
  declare, connect, lang, Color,
  ItemFileReadStore,
  _Widget, _Templated, 
  FilteringSelect, Button, Dialog, 
  template
) {
  var ZoomTo = declare("extras.ZoomTo", [_Widget, _Templated], {
    templateString: template,
    widgetsInTemplate: true,
    started: false,
    map: null,
    mapSpatRef: null,
    defaultSpatRef: 102100, // this needs to match the extents in the .json files
    stateFS: null,
    countyFS: null,
    stateStore: null,
    countyStore: null,
    //ArcGIS Online can be used:  http://sampleserver1.arcgisonline.com/ArcGIS/rest/services/Geometry/GeometryServer
    geomServiceUrl: 'http://your_geometry_service_url',
    
    constructor: function(options, srcNodeRef){
      this.map = options.map;
      // PROVIDE PROPER CONTEXT FOR EVENTS
      this.stateZoomer = lang.hitch(this, this.stateZoomer);
      this.countyZoomer = lang.hitch(this, this.countyZoomer);
      this.zoomerComplete = lang.hitch(this, this.zoomerComplete);
      this.handleExtent = lang.hitch(this, this.handleExtent);
      this.showExtent = lang.hitch(this, this.showExtent);
    },
    
    buildRendering: function(){
      this.inherited(arguments);
    },
      
    startup: function() {
      this.inherited(arguments);

      // if the map isn't loaded, wait for it to load
      if ( !this.map.loaded ) {
        this.mapLoadConnect = connect.connect(this.map, "onLoad", lang.hitch(this, this.startup));
        return;
      }
      connect.disconnect(this.mapLoadConnect);

      this.stateStore = new ItemFileReadStore({
        url: require.toUrl("extras/data/states_web_merc.json"), 
        typeMap: { "Extent": esri.geometry.Extent}
      });
      // console.log("state store: ", this.stateStore);
      
      this.countyStore = new ItemFileReadStore({
        url: require.toUrl("extras/data/counties_web_merc.json"), 
        typeMap: { "Extent": esri.geometry.Extent}
      });

      //populate the states combo box with the state names
      this.stateFS = new FilteringSelect({ 
        name: "states", 
        required: false,
        store: this.stateStore, 
        searchAttr: "name"
      }, this.id + ".stateInput");
      // console.log("states FS: ", stateFS);
      
      //populate the counties combo box with the county names
      this.countyFS = new FilteringSelect({ 
        disabled: true,
        displayedValue: "Please select a state.",
        label: "name",
        name: "counties", 
        required: false, //disables warnings about invalid input
        searchAttr: "name"
      }, this.id + ".countyInput");
            
      //zoom to the extent for a state or county after a selection is made
      connect.connect(this.stateFS, "onChange", this, this.stateZoomer);
      connect.connect(this.countyFS, "onChange", this, this.countyZoomer);

      this.mapSpatRef = this.map.spatialReference.wkid; //keep track of the map's wkid so we know whether or not to use a geom. service
      this.started = true;
    },
      
    handleExtent: function(item){
      //console.log('map: ', this.mapSpatRef, 'default: ', this.defaultSpatRef);
      if (this.mapSpatRef != this.defaultSpatRef) {
        //console.log('projecting the extent...');
        var origExtGraphic = new esri.Graphic(item.extent[0]);
        var geomSvc = new esri.tasks.GeometryService(this.geomServiceUrl);
        geomSvc.project([origExtGraphic], this.map.spatialReference, this.showExtent);
      } else {  
        this.showExtent(item.extent[0]);
      }
    },
      
    showExtent: function(newExtent) {
      var ext;
      //figure out if the object passed in came from a geometry service or if it's straight from our json file
      if (newExtent[0] && typeof(newExtent[0].geometry) != "undefined") { 
        ext = newExtent[0].geometry; //from a geom service
      } else { 
        ext = newExtent; //straight from the json file
      }
      
      //create a copy of the extent because sending the extent to map.setExtent() alters 
      //the extent passed to it which screws up the graphic that we draw...
      var newMapExtent = lang.clone(ext); 
      this.map.setExtent(newMapExtent, true);
      
      var opac = 1;
      //don't start the fade out right away so the map has time to update
      //should probably be listening to a layer's onUpdate event instead but...this is easier
      var sls = esri.symbol.SimpleLineSymbol;
      var sfs = esri.symbol.SimpleFillSymbol;
      setTimeout(function() { 
        var outline = new sls("solid", new Color([0, 0, 0, 1]), 3);
        var symbol = new sfs("solid", outline, new Color([0, 0, 128, 0]));
        var extGraphic = new esri.Graphic(ext, symbol);
        this.map.graphics.add(extGraphic);
        var i_id = setInterval(function() { //fade out the graphic representing the new extent
          //if you want a different color for the extent graphic, alter the rgb values below
          symbol.outline.setColor(new Color([102, 0, 153, opac])); 
          extGraphic.setSymbol(symbol);
          if (opac < 0.01) { //once the graphic is no longer visible:  clear the interval, remove the graphic
            clearInterval(i_id); 
            this.map.graphics.remove(extGraphic);
          }
          opac -= 0.01;
        }, 10);
      }, 1500);
    },
      
    stateZoomer: function(){  
      if (this.map !== null) {
        var placeName = this.stateFS.get("value");
        if (placeName !== "") {
          //dijit.byId(this.id + '.ddDialog').onCancel(); //this will close the drop down button
          //query the data store to get the extent set the map extent equal to the extent from the store
          this.countyFS.attr({ disabled: false, displayedValue: "" });
          this.countyFS.query = { state_name: placeName };
          this.countyFS.set("store", this.countyStore);
            
          //give focus to the county filtering select
          this.countyFS.focus();
          this.stateStore.fetchItemByIdentity({
            identity: placeName, 
            onItem: this.handleExtent, 
            onError: this.errorHandler
          });
        }
      }
    },
      
    countyZoomer: function(){  
      if (this.map !== null) {
        var countyFips = this.countyFS.get("value");
        if (countyFips !== "") {
          //query the data store to get the extent and set the map extent equal to the extent from the store
          this.countyStore.fetchItemByIdentity({
            identity: countyFips, 
            onItem: this.handleExtent, 
            onError: this.errorHandler
          });
        }
      }
    },
    
    errorHandler: function(error){
      console.log("ZoomTo widget error: ", error);
    }
  });

  return ZoomTo;
});
