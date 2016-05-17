/**
 * Created by hydr93 on 09/03/16.
 */

var PlayerTracker = require('../PlayerTracker');
var gameServer = require('../GameServer');
var CommandList = require("../modules/CommandList");

var Reinforce = require("Reinforcejs");

var fs = require("fs");
const JSON_FILE = "./server/ai/json";

const REPORT_FILE = "./server/ai/Reports/report1.txt";

// Number of tries till the cell gets to the TRIAL_RESET_MASS
var trial = 1;

// Server will be restarted when the cell's mass is equal to this.
const TRIAL_RESET_MASS = 100;

// Maximum Speed a cell can have
const MAX_SPEED = 150.0;

// Maximum Distance between two cells
const MAX_DISTANCE = 1450.0;
const MAX_X = 1024;
const MAX_Y = 1024;

const RANGE = 500;

// Maximum Angle :)
const MAX_ANGLE = Math.PI;

// Maximum Mass Difference between two cells.
const MAX_MASS_DIFFERENCE_RATIO = 20;

const MAX_CELL_IN_DIRECTION = 1;
const DIRECTION_COUNT = 8;

function QBot() {
    PlayerTracker.apply(this, Array.prototype.slice.call(arguments));
    //this.color = gameServer.getRandomColor();

    // AI only
    this.directionArray = [];
    for ( var i = 0 ; i < DIRECTION_COUNT ; i++) {
        this.directionArray.push(new Array);
    }

    this.targetPos = {
        x: 0,
        y: 0
    };

    this.previousMass = 10.0;

    // Initialize DQN Environment
    var env = {};
    env.getNumStates = function() { return 3+(3*DIRECTION_COUNT);};
    env.getMaxNumActions = function() {return 8;};
    var spec = {
        update: 'qlearn',
        gamma: 0.9,
        epsilon: 0.2,
        alpha: 0.1,
        experience_add_every: 10,
        experience_size: 5000,
        learning_steps_per_iteration: 20,
        tderror_clamp: 1.0,
        num_hidden_units: 16,
        activation_function: 1
    };
    this.agent;
    try {
        var json = JSON.parse(fs.readFileSync(JSON_FILE,"utf8"));
        //console.log("Reading From JSON");
        this.agent = new Reinforce.RL.DQNAgent(env, spec);
        this.agent.fromJSON(json);
    } catch (e){
        this.agent = new Reinforce.RL.DQNAgent(env,spec);
    }

    // Report the important information to REPORT_FILE
    fs.appendFile(REPORT_FILE, "Test 1:\n\nNumber of States: "+env.getNumStates()+"\nNumber of Actions: "+env.getMaxNumActions()+"\nNumber of Hidden Layers: "+spec.num_hidden_units+" "+"\n");
    var date = new Date();
    //fs.appendFile(REPORT_FILE, "\nStates:\n\tMy Location\n\t\tX\n\t\tY\n\t\tMass\n\t"+ DIRECTION_COUNT +" Directions\n\t\tCell Type\n\t\tDistance\n\t\tMass Ratio\nActions:\n\tWalk\n\t\t8 Directions\n\t\t3 Speed\n");
    fs.appendFile(REPORT_FILE, "\nStates:\n\t"+ DIRECTION_COUNT +" Directions\n\t\tDistance\nActions:\n\tWalk\n\t\t8 Directions");
    fs.appendFile(REPORT_FILE, "\nTrial Reset Mass: "+TRIAL_RESET_MASS+"\n");
    fs.appendFile(REPORT_FILE, "\nTrial No: "+ trial++ +"\n\tBirth: "+date+"\n");

    this.shouldUpdateQNetwork = false;
}

module.exports = QBot;
QBot.prototype = new PlayerTracker();

// Functions

// Returns the lowest cell of the player
QBot.prototype.getBiggestCell = function() {
    // Gets the cell with the lowest mass
    if (this.cells.length <= 0) {
        return null; // Error!
    }

    // Sort the cells by Array.sort() function to avoid errors
    var sorted = this.cells.valueOf();
    sorted.sort(function(a, b) {
        return b.mass - a.mass;
    });

    return sorted[0];
};


// Overrides the update function from player tracker
QBot.prototype.update = function() {

    // Remove nodes from visible nodes if possible
    for (var i = 0; i < this.nodeDestroyQueue.length; i++) {
        var index = this.visibleNodes.indexOf(this.nodeDestroyQueue[i]);
        if (index > -1) {
            this.visibleNodes.splice(index, 1);
        }
    }

    // Respawn if bot is dead
    if (this.cells.length <= 0) {

        if ( this.shouldUpdateQNetwork ){
            console.log("Killed");
            this.agent.learn(-1*this.previousMass);
            this.shouldUpdateQNetwork = false;
            var json = this.agent.toJSON();
            fs.writeFile(JSON_FILE, JSON.stringify(json, null, 4));
        }

        CommandList.list.killall(this.gameServer,0);
        var date = new Date();
        // Report the important information to REPORT_FILE
        fs.appendFile(REPORT_FILE, "\tDeath: "+date+" with Size: "+this.previousMass+"\n");

        this.gameServer.gameMode.onPlayerSpawn(this.gameServer, this);
        if (this.cells.length == 0) {

            // If the bot cannot spawn any cells, then disconnect it
            this.socket.close();
            return;
        }
        var date = new Date();
        console.log(date);
        // Report the important information to REPORT_FILE
        fs.appendFile(REPORT_FILE, "\nTrial No: "+ trial++ +"\n\tBirth: "+date+"\n");
    }

    // Calculate nodes
    this.visibleNodes = this.calcViewBox();

    // Get Lowest cell of the bot
    var cell = this.getBiggestCell();
    this.clearLists();


    // Assign Preys, Threats, Viruses & Foods
    this.updateLists(cell);
    this.sortLists(cell);

    // Action
    if ( this.shouldUpdateQNetwork ){

        this.agent.learn(this.reward());
        this.shouldUpdateQNetwork = false;
        var json = this.agent.toJSON();
        fs.writeFile(JSON_FILE, JSON.stringify(json, null, 4));
    }

    // Learn till the mass is equal to Reset Mass
    if ( cell.mass > TRIAL_RESET_MASS){
        CommandList.list.killall(this.gameServer,0);
        return;
    }

    this.decide(cell);

    // Now update mouse
    this.mouse = {
        x: this.targetPos.x,
        y: this.targetPos.y
    };


    // Reset queues
    this.nodeDestroyQueue = [];
    this.nodeAdditionQueue = [];
};

// Custom

QBot.prototype.clearLists = function() {

    for ( var i = 0 ; i < this.directionArray.length ; i++ ) {
        this.directionArray[i] = [];
    }
};


//Decides the action of player
QBot.prototype.decide = function(cell){

    //var qList = [cell.position.x/6000, cell.position.y/6000, cell.mass/MAX_MASS];
    var qList = [];

    for ( var j = 0 ; j < this.directionArray.length ; j++){
        if ( this.directionArray[j] != null && this.directionArray[j].length > 0){
            var nearby = this.findNearby(cell, this.directionArray[j], MAX_CELL_IN_DIRECTION);
            for ( var i = 0; i < MAX_CELL_IN_DIRECTION; i++){
                if ( nearby != null && i < nearby.length){
                    var distance = this.getDist(cell, nearby[i]);
                    //var massRatio = (Math.min(nearby[i].mass,cell.mass)/Math.max(nearby[i].mass, cell.mass));
                    //if ( cell.mass < nearby[i].mass){
                    //    massRatio = -massRatio;
                    //}
                    var annRange = distance / RANGE;
                    if (annRange > 1 )
                        console.log("ERROR AT RANGE ASSIGN!");
                    qList.push(annRange);
                }else{
                    qList.push(1);
                }
            }
        }else{
            qList.push(1);
        }
    }

    var actionNumber = this.agent.act(qList);
    this.shouldUpdateQNetwork = true;

    var totalMass = 0;
    for ( var i = 0 ; i < this.cells.length ; i++)
        totalMass += this.cells[i].mass;

    var action = this.decodeAction(actionNumber);
    var targetLocation = this.getLocationFromAction(cell, action);
    this.targetPos = {
        x: targetLocation.x,
        y: targetLocation.y
    };

};

// Finds nearby cells in list
QBot.prototype.findNearby = function(cell, list, count) {
    if ( list.length <= 0 || count == 0){
        return null;
    }

    //list.sort(function(a,b){
    //    return QBot.prototype.getDist(cell,a) - QBot.prototype.getDist(cell,b);
    //});

    var nearby = [];

    for (var i = 0; (i < count) && (i < list.length); i++){
        nearby.push(list[i]);
    }

    return nearby;
};

// Returns distance between two cells
QBot.prototype.getDist = function(cell, check) {

    var dx = Math.abs(check.position.x - cell.position.x);
    var dy = Math.abs(check.position.y - cell.position.y);

    var distance = Math.sqrt(dx*dx + dy*dy) - ((cell.getSize()+check.getSize())/2);
    if (distance < 0.0001){
        distance = 0.0001;
    }
    return distance;
};

QBot.prototype.getAngle = function(c1, c2) {
    var deltaY = c1.position.y - c2.position.y;
    var deltaX = c1.position.x - c2.position.x;
    return Math.atan2(deltaX, deltaY);
};

QBot.prototype.reverseAngle = function(angle) {
    if (angle > Math.PI) {
        angle -= Math.PI;
    } else {
        angle += Math.PI;
    }
    return angle;
};


// ADDED BY ME

// Assign Preys, Threats, Viruses & Foods
QBot.prototype.updateLists = function(cell){
    var j = 0;
    for (i in this.visibleNodes) {
        var check = this.visibleNodes[i];

        // Cannot target itself
        if ((!check) || (cell.owner == check.owner)) {
            continue;
        }

        if (this.getDist(cell,check) < RANGE){
            j++;
            this.splitToDirectionArray(cell, check);
        }

    }
};

QBot.prototype.sortLists = function(cell){

    for ( var i = 0 ; i < this.directionArray.length ; i++){
        this.directionArray[i].sort(function(a,b){
            return QBot.prototype.getDist(cell,a) - QBot.prototype.getDist(cell,b);
        });
    }

};

QBot.prototype.splitToDirectionArray = function (cell, check){
    var dy = check.position.y - cell.position.y;
    var dx = check.position.x - cell.position.x;

    var angle = Math.atan2(dx, dy);

    if ( angle < 0 )
        angle += 2*Math.PI;

    var chosenDirection = 0;
    var difference = 9999;
    for ( var i = 0 ; i < DIRECTION_COUNT ; i++){
        var dif = Math.min(Math.abs((i*((2*Math.PI)/DIRECTION_COUNT))-angle),Math.abs((i*((2*Math.PI)/DIRECTION_COUNT))+(2*Math.PI)-angle));
        if ( dif < difference ){
            difference = dif;
            chosenDirection = i;
        }
    }

    this.directionArray[chosenDirection].push(check);

    return;
};

// Transforms Speed to Distance
QBot.prototype.getDistanceFromSpeed = function(speed){
    var distance;
    if (speed < 60){
        distance = 300;
    }else if ( speed < 120){
        distance = 900;
    }else{
        distance = 1500;
    }
    return distance;
};

// Returns Position type class of an Action type class
QBot.prototype.getLocationFromAction = function(cell, action){
    var direction = action.direction;
    var speed = action.speed;
    var distance = this.getDistanceFromSpeed(speed);
    return new Position(cell.position.x + distance * Math.sin(direction), cell.position.y + distance * Math.cos(direction));
};

// Returns the mass difference of two cells
QBot.prototype.getMassDifferenceRatio = function(cell, check){
    var dMass = check.mass/cell.mass;
    if (dMass > MAX_MASS_DIFFERENCE_RATIO)
        dMass = MAX_MASS_DIFFERENCE_RATIO;
    //console.log(dMass);
    return dMass;
};

// Encode - Decode DQN Values
QBot.prototype.decodeAction = function(q){
    var speed;
    var direction;
    speed = 150;
    direction = ((Math.PI)/(DIRECTION_COUNT/2))*(q%DIRECTION_COUNT);
    if ( direction > Math.PI){
        direction -= 2*Math.PI;
    }
    // console.log("Action: \n\tDirection: "+direction+"\n\tSpeed: "+speed);
    return new Action(direction, speed);
};

QBot.prototype.reward = function () {
    var currentMass = 0;
    for ( var i = 0 ; i < this.cells.length ; i++){
        currentMass += this.cells[i].mass;
    }
    var result = currentMass = this.previousMass;
    this.previousMass = currentMass;
    return result;
};

// Necessary Classes

// It shows the action of a cell with direction and speed.
function Action(direction, speed){
    this.direction = direction;
    this.speed = speed;
};

// A position class with X and Y
function Position(x, y){
    this.x = x;
    this.y = y;
}
