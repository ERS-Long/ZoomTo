define([
    'require',
    'dojo/_base/declare',
    'dijit/_WidgetBase',
    'dijit/_TemplatedMixin',
    'dijit/_WidgetsInTemplateMixin',

    'dojo/_base/connect',
    'dojo/_base/lang',
    'dojo/_base/Color',
    'dojo/topic',
    'dojo/domReady!',
    'dojo/aspect',
    'dojo/data/ItemFileReadStore',
    'dijit/form/FilteringSelect',
    'dojo/text!./ZoomTo/templates/ZoomTo.html',
    'dijit/form/Button',
    'dijit/Dialog',
    'dijit/TooltipDialog',
    'dijit/form/DropDownButton',

    'xstyle/css!./ZoomTo/css/ZoomTo.css'


], function (
    require,
    declare,
    _WidgetBase,
    _TemplatedMixin, 
    _WidgetsInTemplateMixin,

    connect,
    lang,
    Color,
    topic,
    ready,
    aspect,
    ItemFileReadStore,
    FilteringSelect,
    template,
    Button,
    Dialog,
    TooltipDialog,
    DropDownButton    
) {
  var map;

  return declare([_WidgetBase, _TemplatedMixin, _WidgetsInTemplateMixin], {
      map: true,
      widgetsInTemplate: true,
      templateString: template,

      mapSpatRef: null,
      defaultSpatRef: 102100, // this needs to match the extents in the .json files
      stateFS: null,
      countyFS: null,
      stateStore: null,
      countyStore: null,
      geomServiceUrl: 'http://tasks.arcgisonline.com/ArcGIS/rest/services/Geometry/GeometryServer',

      postCreate: function () {
          this.inherited(arguments);
          map = this.map;
          this.mapSpatRef = this.map.spatialReference.wkid; //keep track of the map's wkid so we know whether or not to use a geom. service

          this.stateZoomer = lang.hitch(this, this.stateZoomer);
          this.countyZoomer = lang.hitch(this, this.countyZoomer);
          this.zoomerComplete = lang.hitch(this, this.zoomerComplete);
          this.handleExtent = lang.hitch(this, this.handleExtent);
          this.showExtent = lang.hitch(this, this.showExtent);          

          if (this.parentWidget && this.parentWidget.toggleable) {
              this.own(aspect.after(this.parentWidget, 'toggle', lang.hitch(this, function () {
                  this.onLayoutChange(this.parentWidget.open);
              })));
          }            
      },

      startUp: function()
      {
          this.stateStore = new ItemFileReadStore({
              url: require.toUrl("./ZoomTo/data/states_web_merc.json"), 
              typeMap: { "Extent": esri.geometry.Extent}
          });
         //console.log("state store: ", this.stateStore);
          
          this.countyStore = new ItemFileReadStore({
              url: require.toUrl("./ZoomTo/data/counties_web_merc.json"), 
              typeMap: { "Extent": esri.geometry.Extent}
          });

          //populate the states combo box with the state names
          this.stateFS = new FilteringSelect({
              name: "states", 
              required: false,
              store: this.stateStore,
              value: ".", 
              searchAttr: "name"
          }, this.id + ".stateInput");
          //console.log("states FS: ", this.stateFS);
          
          //populate the counties combo box with the county names
          this.countyFS = new FilteringSelect({ 
              disabled: true,
              displayedValue: "Please select a state.",
              label: "name",
              name: "counties", 
              required: false, //disables warnings about invalid input
              searchAttr: "name"
          }, this.id + ".countyInput");

          this.stateFS.value = "";

          //zoom to the extent for a state or county after a selection is made
          connect.connect(this.stateFS, "onChange", this, this.stateZoomer);
          connect.connect(this.countyFS, "onChange", this, this.countyZoomer);
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
              
              map.graphics.add(extGraphic);

              var i_id = setInterval(function() { //fade out the graphic representing the new extent
                  //if you want a different color for the extent graphic, alter the rgb values below
                  symbol.outline.setColor(new Color([102, 0, 153, opac])); 
                  extGraphic.setSymbol(symbol);
                  if (opac < 0.01) { //once the graphic is no longer visible:  clear the interval, remove the graphic
                      clearInterval(i_id); 
                      map.graphics.remove(extGraphic);
                  }
                  opac -= 0.01;
              }, 50);
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
      },

      onLayoutChange: function (open) {
          if (open) {
              this.startUp();
          } else {
          }
      } 
  });

});    