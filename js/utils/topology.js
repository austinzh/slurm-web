/*
 * Copyright (C) 2015 EDF SA
 *
 * This file is part of slurm-web.
 *
 * slurm-web is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * slurm-web is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with slurm-web.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

define([
  'text!/slurm-web-conf/topology.config.json'
], function(config) {
  var id, node, nodeset;

  config = JSON.parse(config);

  function Graph(topology) {
    this.nodes = [];
    this.links = [];

    this.createSwitch = function(data) {
      data.group = data.level + 3;
      data.index = this.nodes.length;
      this.nodes.push({
        name: data.name,
        group: data.group,
        nodeClass: 'switch',
        size: config.SWITCHRADIUS
      });

      if (data.level === 0) {
        this.nodes[data.index].nodeset = data.nodeset;
        this.nodes[data.index].nodes = data.nodes;

        data.d3nodes = [];
        for (id in this.nodes[data.index].nodes) {
          node = {
            name: this.nodes[data.index].nodes[id].name,
            group: 1,
            nodeClass: 'slurmnode',
            index: this.nodes.length,
            size: config.NODERADIUS
          };
          data.d3nodes.push(node);
          this.nodes.push(node);
        }

        nodeset = {
          name: data.nodeset.join(),
          group: 2,
          nodeClass: 'nodeset',
          nodes: data.d3nodes,
          size: config.NODESETRADIUS
        };
        this.nodes[data.index].nodesetIndex = data.nodesetIndex = this.nodes.length;
        this.nodes.push(nodeset);
        data.d3nodeset = nodeset;
      }

      return data;
    };

    this.createEdges = function() {
      var i, switches, s, linkedElements, id, linkedElement, index, link;

      for (i = 0; i < topology.levels; i++) {
        switches = topology.switches['level-' + i];

        for (id in switches) {
          s = switches[id];
          linkedElements = s.level ? s.switches : {};

          // if (s.computed) break;

          for (id in linkedElements) {
            linkedElement = s.level ? topology.switches['level-' + (s.level - 1)][id] : topology.nodes[id];

            if (typeof s.index !== 'undefined' && typeof linkedElement.index !== 'undefined') {
              this.links.push({
                source: s.index,
                target: linkedElement.index,
                value: 1,
                linkClass: 'link-switch-' + s.name
              });
            }
          }

          if (typeof s.index !== 'undefined' && s.nodesetIndex) {
            this.nodes[s.nodesetIndex].links = [];
            this.links.push({
              source: s.index,
              target: s.nodesetIndex,
              value: 1,
              linkClass: 'link-nodeset-' + s.name
            });

            for (index = 0; index < s.d3nodes.length; index++) {
              link = {
                source: s.nodesetIndex,
                target: s.d3nodes[index].index,
                value: 1,
                linkClass: 'link-node link-nodes-' + s.name
              };
              this.links.push(link);
              this.nodes[s.nodesetIndex].links.push(link);
            }
          }

          s.computed = true;
        }
      }
    };

    this.createGraph = function() {
      var i, curSwitches, id,
        levels = topology.levels,
        switches = topology.switches;

      // generate switches
      for (i = 0; i < levels; i++) {
        curSwitches = switches['level-' + i];

        for (id in curSwitches) {
          this.createSwitch(curSwitches[id]);
        }
      }

      this.createEdges();

      return this;
    };
  }

  function Topology(topology) {
    this.config = config;
    this.rawDatas = topology;
    this.nodes = {};

    function pad(num, size) {
      var s = String(num);

      while (s.length < size) {
        s = '0' + s;
      }
      return s;
    }

    function groupsToElements(groups) {
      var i, matchOne, matchGroup, name, start, end, size, number,
        result = [],
        regexOne = /(\w+)\[?(\d+)\]?/,
        regexGroup = /(\w+)\[(\d+)\-(\d+)\]/;

      for (i in groups) {
        matchOne = groups[i].match(regexOne);
        matchGroup = groups[i].match(regexGroup);
        if (!matchOne && !matchGroup) {
          throw 'Bad format with : ' + groups[i];
        }

        if (matchGroup) {
          name = matchGroup[1];
          start = parseInt(matchGroup[2], 10);
          end = parseInt(matchGroup[3], 10);
          size = matchGroup[2].length;

          for (i = start; i <= end; i++) {
            number = pad(i, size);
            result.push(name + number);
          }
        } else if (matchOne) {
          name = matchOne[1];
          number = matchOne[2];
          result.push(name + number);
        }
      }

      return result;
    }

    function normalizeSwitchesSyntax(switches) {
      var i, matchGroup, matchBeginOfGroup, matchMiddleOfGroup, matchEndOfGroup,
        regexGroup = /(\w+)\[(\d+)\-(\d+)\]/,
        regexBeginOfGroup = /(\w+)\[(\d+)(\-(\d+))?/,
        regexMiddleOfGroup = /(\d+)(\-(\d+))?/,
        regexEndOfGroup = /((\d+)\-)?(\d+)\]/,
        currentGroup = null,
        result = [];

      for (i in switches) {
        matchGroup = switches[i].match(regexGroup);
        matchBeginOfGroup = switches[i].match(regexBeginOfGroup);
        matchMiddleOfGroup = switches[i].match(regexMiddleOfGroup);
        matchEndOfGroup = switches[i].match(regexEndOfGroup);

        if (matchGroup) {
          result.push(switches[i]);
        } else if (matchBeginOfGroup) {
          result.push(switches[i] + ']');
          currentGroup = matchBeginOfGroup[1];
        } else if (matchMiddleOfGroup && currentGroup) {
          result.push(currentGroup + '[' + switches[i] + ']');
        } else if (matchEndOfGroup && currentGroup) {
          result.push(currentGroup + '[' + switches[i]);
          currentGroup = null;
        } else {
          throw 'Bad format for switches with : ' + switches[i];
        }
      }

      return result;
    }

    this.topologyToSwitches = function() {
      var i, id, level, nodesChildren, switchesChildren,
        switches = {},
        datas = this.rawDatas;

      for (id in datas) {
        level = 'level-' + datas[id].level;
        if (!switches[level]) {
          switches[level] = {};
        }

        switches[level][id] = datas[id];
        switches[level][id].name = id;
        switches[level][id].type = 'switch';

        nodesChildren = groupsToElements(datas[id].nodes);
        switchesChildren = groupsToElements(normalizeSwitchesSyntax(datas[id].switches));

        datas[id].nodeset = datas[id].nodes;
        switches[level][id].nodes = {};
        for (i in nodesChildren) {
          switches[level][id].nodes[nodesChildren[i]] = {
            name: nodesChildren[i],
            type: 'node'
          };
          this.nodes[nodesChildren[i]] = switches[level][id].nodes[nodesChildren[i]];
        }

        switches[level][id].switches = {};
        for (i in switchesChildren) {
          switches[level][id].switches[switchesChildren[i]] = {
            name: switchesChildren[i],
            type: 'switch'
          };
        }
      }

      return switches;
    };

    this.switches = this.topologyToSwitches();
    this.levels = Object.keys(this.switches).length;
    this.graph = (new Graph(this)).createGraph();
  }

  return Topology;
});
