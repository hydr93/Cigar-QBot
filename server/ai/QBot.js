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

// Maximum Angle :)
const MAX_ANGLE = Math.PI;

// Maximum Mass Difference between two cells.
const MAX_MASS_DIFFERENCE = 20;

const FOOD_NO = 1;
const VIRUS_NO = 0;
const THREAT_NO = 0;
const PREY_NO = 0;

const DIRECTION_COUNT = 8;

function QBot() {
    PlayerTracker.apply(this, Array.prototype.slice.call(arguments));
    //this.color = gameServer.getRandomColor();

    // AI only

    this.threats = []; // List of cells that can eat this bot but are too far away
    this.prey = []; // List of cells that can be eaten by this bot
    this.food = [];
    this.virus = []; // List of viruses

    this.targetPos = {
        x: 0,
        y: 0
    };

    this.previousMass = 10.0;

    // Initialize DQN Environment
    var env = {};
    env.getNumStates = function() { return (2*FOOD_NO + 4*VIRUS_NO + 4*THREAT_NO + 4*PREY_NO);};
    env.getMaxNumActions = function() {return DIRECTION_COUNT;}
    var spec = {
        update: 'qlearn',
        gamma: 0.9,
        epsilon: 0.2,
        alpha: 0.1,
        experience_add_every: 10,
        experience_size: 5000,
        learning_steps_per_iteration: 20,
        tderror_clamp: 1.0,
        num_hidden_units: 8,
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
    fs.appendFile(REPORT_FILE, "Test 1, No Virus, No Enemy:\n\nNumber of Inputs: "+env.getNumStates()+"\nNumber of Actions: "+env.getMaxNumActions()+"\nNumber of Hidden Units: "+spec.num_hidden_units+"\n");
    var date = new Date();
    fs.appendFile(REPORT_FILE, "\nStates:\n\t"+ FOOD_NO +" Food\n\t\tX Difference\n\t\tY Difference\nnActions:\n\tWalk\n\t\t"+ DIRECTION_COUNT +" Directions\n\t\tSpeed\n");
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

            this.agent.learn(1);
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

    // Learn till the mass is equal to Reset Mass
    if ( cell.mass > TRIAL_RESET_MASS){
        CommandList.list.killall(this.gameServer,0);
        return;
    }

    // Assign Preys, Threats, Viruses & Foods
    this.updateLists(cell);

    this.food.sort(function(a,b){
        return QBot.prototype.getDist(cell,a) - QBot.prototype.getDist(cell,b);
    });
    this.prey.sort(function(a,b){
        return QBot.prototype.getDist(cell,a) - QBot.prototype.getDist(cell,b);
    });
    this.threats.sort(function(a,b){
        return QBot.prototype.getDist(cell,a) - QBot.prototype.getDist(cell,b);
    });
    this.virus.sort(function(a,b){
        return QBot.prototype.getDist(cell,a) - QBot.prototype.getDist(cell,b);
    });

    // Action
    if ( this.shouldUpdateQNetwork ){

        this.agent.learn(this.reward());
        this.shouldUpdateQNetwork = false;
        var json = this.agent.toJSON();
        fs.writeFile(JSON_FILE, JSON.stringify(json, null, 4));
    }

    this.decide(cell);

    //console.log("Current Position\nX: "+cell.position.x+"\nY: "+cell.position.y);
    //console.log("Destination Position\nX: "+this.targetPos.x+"\nY: "+this.targetPos.y);

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
    this.threats = [];
    this.prey = [];
    this.food = [];
    this.virus = [];
};


//Decides the action of player
QBot.prototype.decide = function(cell) {

    // Find Nearby N Foods
    var nearbyFoods = this.findNearby(cell,this.food,FOOD_NO);
    if ( nearbyFoods == null || nearbyFoods.length == 0){
        CommandList.list.killall(this.gameServer,0);
        return;
    }
    var qList = []; //[1-(Math.abs(cell.position.x - 3000)/3000.0), 1-(Math.abs(cell.position.y - 3000)/3000.0)];
    for ( var i = 0; i < FOOD_NO; i++){
        if ( nearbyFoods != null && i < nearbyFoods.length ){
            //var foodStateVector = this.getStateVectorFromLocation(cell, nearbyFoods[i]);
            var foodDistanceVector = this.getDistanceVector(cell,nearbyFoods[i]);
            //var foodEnabler = 1;
            qList.push((foodDistanceVector.x/MAX_X), (foodDistanceVector.y/MAX_Y));
            //qList.push(foodStateVector.direction/MAX_ANGLE, foodStateVector.distance/MAX_DISTANCE);
        }
    }
    //console.log(qList);
    if ( qList.length == 0){
        return;
    }

    //// Find Nearby N Viruses
    //var nearbyViruses = this.findNearby(cell,this.virus,VIRUS_NO);
    //for ( var i = 0; i < VIRUS_NO; i++){
    //    if ( nearbyViruses != null && i < nearbyViruses.length){
    //        var virusStateVector = this.getStateVectorFromLocation(cell,nearbyViruses[i]);
    //        var virusEnabler = 1;
    //        qList.push(virusEnabler,(((virusStateVector.direction/MAX_ANGLE)+1)/2.0),virusStateVector.distance/MAX_DISTANCE,  this.compareCellWithVirus(cell,nearbyViruses[i]));
    //    }else{
    //        qList.push(-1,-1,-1,0);
    //    }
    //}
    //
    //// Find Nearby N Preys
    //var nearbyPreys = this.findNearby(cell,this.prey,PREY_NO);
    //for ( var i = 0; i < PREY_NO; i++){
    //    if ( nearbyPreys != null && i < nearbyPreys.length ){
    //        var preyStateVector = this.getStateVectorFromLocation(cell,nearbyPreys[i]);
    //        var preyEnabler = 1;
    //        var preyMassDifference = this.getMassDifference(cell,nearbyPreys[i]);
    //        qList.push(preyEnabler,(((preyStateVector.direction/MAX_ANGLE)+1)/2.0),preyStateVector.distance/MAX_DISTANCE,preyMassDifference/MAX_MASS_DIFFERENCE);
    //    }else{
    //        qList.push(-1,-1,-1,0);
    //    }
    //}
    //
    //// Find Nearby N Threats
    //var nearbyThreats = this.findNearby(cell,this.threats,THREAT_NO);
    //for ( var i = 0; i < THREAT_NO; i++){
    //    if ( nearbyThreats != null && i < nearbyThreats.length ){
    //        var threatsStateVector = this.getStateVectorFromLocation(cell,nearbyThreats[i]);
    //        var threatsEnabler = 1;
    //        var threatMassDifference = this.getMassDifference(cell,nearbyThreats[i]);
    //        qList.push(threatsEnabler,(((threatsStateVector.direction/MAX_ANGLE)+1)/2.0),threatsStateVector.distance/MAX_DISTANCE,threatMassDifference/MAX_MASS_DIFFERENCE);
    //    }else{
    //        qList.push(-1,-1,-1,0);
    //    }
    //}
    this.currentState = qList;
    var actionNumber = this.agent.act(qList);

    var totalMass = 0;
    for ( var i = 0 ; i < this.cells.length ; i++)
        totalMass += this.cells[i].mass;

    var action = this.decodeAction(actionNumber);
    var targetLocation = this.getLocationFromAction(cell, action);
    this.targetPos = {
        x: targetLocation.x,
        y: targetLocation.y
    };
    this.shouldUpdateQNetwork = true;

};

// Finds nearby cells in list
QBot.prototype.findNearby = function(cell, list, count) {
    if ( list.length <= 0 || count == 0){
        return null;
    }

    list.sort(function(a,b){
        return QBot.prototype.getDist(cell,a) - QBot.prototype.getDist(cell,b);
    });

    var nearby = [];

    for (var i = 0; (i < count) && (i < list.length); i++){
        nearby.push(list[i]);
    }

    return nearby;
};

// Returns distance vector between two cells
QBot.prototype.getDistanceVector = function(cell, check) {

    var dx = check.position.x - cell.position.x;
    var dy = check.position.y - cell.position.y;

    return new DistanceVector(dx,dy);
};

// Returns distance between two cells
QBot.prototype.getDist = function(cell, check) {

    var dx = Math.abs(check.position.x - cell.position.x);
    var dy = Math.abs(check.position.y - cell.position.y);

    var distance = Math.sqrt(dx*dx + dy*dy) - ((cell.getSize()+check.getSize())/2);
    if (distance < 0){
        distance = 0;
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
    for (i in this.visibleNodes) {
        var check = this.visibleNodes[i];

        // Cannot target itself
        if ((!check) || (cell.owner == check.owner)) {
            continue;
        }

        var t = check.getType();
        switch (t) {
            case 0:
                // Cannot target teammates
                if (this.gameServer.gameMode.haveTeams) {
                    if (check.owner.team == this.team) {
                        continue;
                    }
                }

                // Check for danger
                if (cell.mass > (check.mass * 1.33)) {
                    // Add to prey list
                    this.prey.push(check);
                } else if (check.mass > (cell.mass * 1.33)) {
                    this.threats.push(check);
                }
                break;
            case 1:
                this.food.push(check);
                break;
            case 2: // Virus
                if (!check.isMotherCell) {
                    this.virus.push(check);
                } // Only real viruses! No mother cells
                break;
            case 3: // Ejected mass
                if (cell.mass > 20) {
                    this.food.push(check);
                }
                break;
            default:
                break;
        }
    }
};

// Returns Direction from Location
QBot.prototype.getDirectionFromLocation = function(cell, check){

    var dy = check.position.y - cell.position.y;
    var dx = check.position.x - cell.position.x;

    var direction = Math.atan2(dx, dy);
    return direction;
};

// Transforms Distance to Speed
QBot.prototype.getSpeedFromDistance = function(distance){
    var speed;
    if ( distance < 600 ){
        speed = 30;
    }else if ( distance < 1200){
        speed = 90;
    }else{
        speed = 150;
    }
    return speed;
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

//// Returns StateVector type class from the location of two cells
QBot.prototype.getStateVectorFromLocation = function(cell, check){
    var distance = this.getDist(cell,check);
    var direction = this.getDirectionFromLocation(cell, check);
    return new StateVector(direction,distance);
};

// Returns Position type class of an Action type class
QBot.prototype.getLocationFromAction = function(cell, action){
    var direction = action.direction;
    var speed = action.speed;
    var distance = this.getDistanceFromSpeed(speed);
    return new Position(cell.position.x + distance * Math.sin(direction), cell.position.y + distance * Math.cos(direction));
};

QBot.prototype.compareCellWithVirus = function(cell, virus){
    if (cell.mass * 1.33 > virus.mass)
        return 1;
    else
        return 0;
};

// Returns the mass difference of two cells
QBot.prototype.getMassDifference = function(cell, check){
    var dMass = Math.round((cell.mass - check.mass)/10);
    if (dMass > MAX_MASS_DIFFERENCE)
        dMass = MAX_MASS_DIFFERENCE;
    else if (dMass < -MAX_MASS_DIFFERENCE)
        dMass = -MAX_MASS_DIFFERENCE;
    //console.log(dMass);
    return dMass;
};

// Encode - Decode DQN Values
QBot.prototype.decodeAction = function(q){
    
    var speed = 150;
    var direction;
    direction = ((Math.PI)/(DIRECTION_COUNT/2))*(q%DIRECTION_COUNT);
    if ( direction > Math.PI){
        direction -= 2*Math.PI;
    }
    // console.log("Action: \n\tDirection: "+direction+"\n\tSpeed: "+speed);
    return new Action(direction, speed);
};

QBot.prototype.reward = function (){

    var currentMass = 0;
    for ( var i = 0 ; i < this.cells.length ; i++){
        currentMass += this.cells[i].mass;
    }
    var result = currentMass - this.previousMass;
    this.previousMass = currentMass;
    return result;
}

// Necessary Classes

// It shows the action of a cell with direction and speed.
function Action(direction, speed){
    this.direction = direction;
    this.speed = speed;
};

// It shows the state of a cell according to other cell with direction and distance
function StateVector(direction, distance){
    this.direction = direction;
    this.distance = distance;
};

function DistanceVector(x,y){
    this.x = x;
    this.y = y;
}

// A position class with X and Y
function Position(x, y){
    this.x = x;
    this.y = y;
}
