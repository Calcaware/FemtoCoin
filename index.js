// Minimal Blockchain Implementation
// Author: Calcaware

const fs = require('fs');

class Femto {

	constructor(path = null) {
		if (path == null)
			throw new Error("Path to state file not defined!");
		this.path = path;
		this.state = null;
		this.loadState(path);
		this.initiated = Date.now();
	}

	loadState(path = null) {
		if (path == null)
			path = this.path;
		this.state = JSON.parse(fs.readFileSync(path).toString());
	}

	saveState(path = null) {
		if (path == null)
			path = this.path;
		fs.writeFileSync(path, JSON.stringify(this.state, null, '\t'));
	}

	getSupply() {
		let supply = 0;
		let ids = Object.keys(this.state);
		for (let i = 0; i < ids.length; i++)
			supply += this.state[ids[i]];
		return supply;
	}

	getValue() {
		return 1 / this.getSupply();
	}

	getBalance(id, key) {
		if (Object.keys(this.state).indexOf(id) === -1)
			return { "success": false, "message": `${id} doesn't exist!` };;
		if (!this.validate(id, key)) {
			console.log(`	${id} gave an invalid key!`);
			return { "success": false, "message": `${id} gave an invalid key!` };
		}
		return this.state[id];
	}

	exists(id) {
		if (Object.keys(this.state).indexOf(id) === -1)
			return false;
		return true;
	}

	send(from, key, to, amount, save = false) {
		console.log(`${from} attempting to send ${amount} to ${to}.`)

		if (!this.validate(from, key)) {
			console.log(`	${from} gave an invalid key!`);
			return { "success": false, "message": `${from} gave an invalid key!` };
		}

		if (from == to) {
			console.log(`	${from} can't send to self!`);
			return { "success": false, "message": `${from} can't send to self!` };
		}
		
		if (!this.exists(from)) {
			console.log(`	${from} not found!`);
			return { "success": false, "message": `${from} not found!` };
		}
		
		if (!this.exists(to)) {
			console.log(`	${to} not found!`);
			return { "success": false, "message": `${to} not found!` };
		}

		if (!Number.isInteger(amount) || amount < 1) {
			console.log(`	Amount must be a positive integer!`);
			return { "success": false, "message": `Amount must be a positive integer!` };
		}
		
		if (this.state[from] < amount) {
			console.log(`	${from} doesn't have enough!`);
			return { "success": false, "message": `${from} doesn't have enough!` };
		}
		
		this.state[from] -= amount;
		this.state[to] += amount;
		
		if (save)
			this.saveState(this.path);
		console.log(`	Success.`)
		return { "success": true, "message": null };
	}

	validate(id, key) {
		if (this.createKey(id) == key)
			return true;
		return false;
	}

	createId(length = 16) {
    	var result = '';
    	var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    	var charactersLength = characters.length;
    	for (let i = 0; i < length; i++)
    		result += characters.charAt(Math.floor(Math.random() * charactersLength));
    	return result;
    }

    createKey(id) {
    	var hash = 0, i, chr;
  		if (id.length === 0)
  			return hash;
		for (i = 0; i < id.length; i++) {
    		chr   = id.charCodeAt(i);
    		hash  = ((hash << 5) - hash) + chr;
    		hash |= 0;
    	}
    	return Math.abs(hash).toString(16);
    }

    createAccount(save = false) {
    	let account = { "id": this.createId(), "key": null };
    	account.key = this.createKey(account.id);
    	this.state[account.id] = 1; //Math.floor(Math.random() * Object.keys(this.state).length);
    	if (save)
    		this.saveState();
    	return account;
    }

}


(() => {
	console.log("Blockchain Started");

	const femto = new Femto("data/state.json");

	//for (let i = 0; i < 10; i++)
		//console.log(femto.createAccount());

	femto.send("hnx0XOFkI1gplkOE", "5633dda0", "jB0WrRc0Bqi9KYal", 1);

	//femto.saveState();

	// Mix Around
	/*for (let i = 0; i < 50; i++) {
		let from = Object.keys(femto.state)[Math.floor(Math.random() * Object.keys(femto.state).length)];
		let from_key = femto.createKey(from);
		let to = Object.keys(femto.state)[Math.floor(Math.random() * Object.keys(femto.state).length)];
		let amount = femto.state[from];
		femto.send(from, from_key, to, Math.floor(amount / 2));
	}*/
	
	femto.saveState();

	console.log("Supply: " + femto.getSupply());
	console.log("Relative Value: " + femto.getValue());

})();
